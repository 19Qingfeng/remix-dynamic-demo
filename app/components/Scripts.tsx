import { UNSAFE_RemixContext } from '@remix-run/react';
import type { ScriptProps } from '@remix-run/react/dist/components';
import { Await } from '@remix-run/react/dist/components';
import {
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  useNavigation,
  useAsyncError,
  matchRoutes,
} from 'react-router-dom';
import { useContext, useEffect, useMemo, Suspense } from 'react';
import type {
  UNSAFE_DeferredData as DeferredData,
  TrackedPromise,
} from '@remix-run/router';

export interface SafeHtml {
  __html: string;
}

export function createHtml(html: string): SafeHtml {
  return { __html: html };
}

const ESCAPE_LOOKUP: { [match: string]: string } = {
  '&': '\\u0026',
  '>': '\\u003e',
  '<': '\\u003c',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

const ESCAPE_REGEX = /[&><\u2028\u2029]/g;

export function escapeHtml(html: string) {
  return html.replace(ESCAPE_REGEX, (match) => ESCAPE_LOOKUP[match]);
}

export default function invariant(
  value: boolean,
  message?: string
): asserts value;
export default function invariant<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T;
export default function invariant(value: any, message?: string) {
  if (value === false || value === null || typeof value === 'undefined') {
    throw new Error(message);
  }
}

function ErrorDeferredHydrationScript({
  dataKey,
  routeId,
}: {
  dataKey: string;
  routeId: string;
}) {
  let error = useAsyncError() as Error;
  let toSerialize: { message: string; stack?: string } = {
    message: error.message,
    stack: undefined,
  };
  if (process.env.NODE_ENV === 'development') {
    toSerialize.stack = error.stack;
  }

  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: `__remixContext.r(${JSON.stringify(routeId)}, ${JSON.stringify(
          dataKey
        )}, !1, ${escapeHtml(JSON.stringify(toSerialize))});`,
      }}
    />
  );
}

function DeferredHydrationScript({
  dataKey,
  deferredData,
  routeId,
}: {
  dataKey?: string;
  deferredData?: DeferredData;
  routeId?: string;
}) {
  if (typeof document === 'undefined' && deferredData && dataKey && routeId) {
    invariant(
      deferredData.pendingKeys.includes(dataKey),
      `Deferred data for route ${routeId} with key ${dataKey} was not pending but tried to render a script for it.`
    );
  }

  return (
    <Suspense
      fallback={
        // This makes absolutely no sense. The server renders null as a fallback,
        // but when hydrating, we need to render a script tag to avoid a hydration issue.
        // To reproduce a hydration mismatch, just render null as a fallback.
        typeof document === 'undefined' &&
        deferredData &&
        dataKey &&
        routeId ? null : (
          <script
            async
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: ' ' }}
          />
        )
      }
    >
      {typeof document === 'undefined' && deferredData && dataKey && routeId ? (
        <Await
          resolve={deferredData.data[dataKey]}
          errorElement={
            <ErrorDeferredHydrationScript dataKey={dataKey} routeId={routeId} />
          }
          children={(data) => (
            <script
              async
              suppressHydrationWarning
              dangerouslySetInnerHTML={{
                __html: `__remixContext.r(${JSON.stringify(
                  routeId
                )}, ${JSON.stringify(dataKey)}, ${escapeHtml(
                  JSON.stringify(data)
                )});`,
              }}
            />
          )}
        />
      ) : (
        <script
          async
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: ' ' }}
        />
      )}
    </Suspense>
  );
}

/**
 * Tracks whether Remix has finished hydrating or not, so scripts can be skipped
 * during client-side updates.
 */
let isHydrated = false;

/**
 * Renders the `<script>` tags needed for the initial render. Bundles for
 * additional routes are loaded later as needed.
 *
 * @param props Additional properties to add to each script tag that is rendered.
 * In addition to scripts, \<link rel="modulepreload"> tags receive the crossOrigin
 * property if provided.
 *
 * @see https://remix.run/components/scripts
 */

type _ScriptProps = ScriptProps & { prefix?: string };

const addPrefix = (url: string, prefix?: string) =>
  prefix ? prefix + url : url;

// 仅仅拦截 入口文件，其他资源启动服务时进行动态生成
export function Scripts(p: _ScriptProps) {
  const { prefix, ...props } = p;

  const remixContext = useContext(UNSAFE_RemixContext);
  const routeModules = useContext(UNSAFE_DataRouterContext);
  const routerContext = useContext(UNSAFE_DataRouterStateContext);

  if (!remixContext || !routeModules || !routerContext) {
    throw new Error('Context Must Provide');
  }

  const { manifest, serverHandoffString, abortDelay } = remixContext;
  const { router, static: isStatic, staticContext } = routeModules;
  const { matches } = routerContext;

  let navigation = useNavigation();

  useEffect(() => {
    isHydrated = true;
  }, []);

  let deferredScripts: any[] = [];

  // 初始化脚本
  let initialScripts = useMemo(() => {
    let contextScript = staticContext
      ? `window.__remixContext = ${serverHandoffString};`
      : ' ';

    let activeDeferreds = staticContext?.activeDeferreds;
    // This sets up the __remixContext with utility functions used by the
    // deferred scripts.
    // - __remixContext.p is a function that takes a resolved value or error and returns a promise.
    //   This is used for transmitting pre-resolved promises from the server to the client.
    // - __remixContext.n is a function that takes a routeID and key to returns a promise for later
    //   resolution by the subsequently streamed chunks.
    // - __remixContext.r is a function that takes a routeID, key and value or error and resolves
    //   the promise created by __remixContext.n.
    // - __remixContext.t is a a map or routeId to keys to an object containing `e` and `r` methods
    //   to resolve or reject the promise created by __remixContext.n.
    // - __remixContext.a is the active number of deferred scripts that should be rendered to match
    //   the SSR tree for hydration on the client.
    contextScript += !activeDeferreds
      ? ''
      : [
          '__remixContext.p = function(v,e,p,x) {',
          "  if (typeof e !== 'undefined') {",
          '    x=new Error(e.message);',
          process.env.NODE_ENV === 'development' ? `x.stack=e.stack;` : '',
          '    p=Promise.reject(x);',
          '  } else {',
          '    p=Promise.resolve(v);',
          '  }',
          '  return p;',
          '};',
          '__remixContext.n = function(i,k) {',
          '  __remixContext.t = __remixContext.t || {};',
          '  __remixContext.t[i] = __remixContext.t[i] || {};',
          '  let p = new Promise((r, e) => {__remixContext.t[i][k] = {r:(v)=>{r(v);},e:(v)=>{e(v);}};});',
          typeof abortDelay === 'number'
            ? `setTimeout(() => {if(typeof p._error !== "undefined" || typeof p._data !== "undefined"){return;} __remixContext.t[i][k].e(new Error("Server timeout."))}, ${abortDelay});`
            : '',
          '  return p;',
          '};',
          '__remixContext.r = function(i,k,v,e,p,x) {',
          '  p = __remixContext.t[i][k];',
          "  if (typeof e !== 'undefined') {",
          '    x=new Error(e.message);',
          process.env.NODE_ENV === 'development' ? `x.stack=e.stack;` : '',
          '    p.e(x);',
          '  } else {',
          '    p.r(v);',
          '  }',
          '};',
        ].join('\n') +
        Object.entries(activeDeferreds)
          .map(([routeId, deferredData]) => {
            let pendingKeys = new Set(deferredData.pendingKeys);
            let promiseKeyValues = deferredData.deferredKeys
              .map((key) => {
                if (pendingKeys.has(key)) {
                  deferredScripts.push(
                    <DeferredHydrationScript
                      key={`${routeId} | ${key}`}
                      deferredData={deferredData}
                      routeId={routeId}
                      dataKey={key}
                    />
                  );

                  return `${JSON.stringify(
                    key
                  )}:__remixContext.n(${JSON.stringify(
                    routeId
                  )}, ${JSON.stringify(key)})`;
                } else {
                  let trackedPromise = deferredData.data[key] as TrackedPromise;
                  if (typeof trackedPromise._error !== 'undefined') {
                    let toSerialize: { message: string; stack?: string } = {
                      message: trackedPromise._error.message,
                      stack: undefined,
                    };
                    if (process.env.NODE_ENV === 'development') {
                      toSerialize.stack = trackedPromise._error.stack;
                    }
                    return `${JSON.stringify(
                      key
                    )}:__remixContext.p(!1, ${escapeHtml(
                      JSON.stringify(toSerialize)
                    )})`;
                  } else {
                    if (typeof trackedPromise._data === 'undefined') {
                      throw new Error(
                        `The deferred data for ${key} was not resolved, did you forget to return data from a deferred promise?`
                      );
                    }
                    return `${JSON.stringify(
                      key
                    )}:__remixContext.p(${escapeHtml(
                      JSON.stringify(trackedPromise._data)
                    )})`;
                  }
                }
              })
              .join(',\n');
            return `Object.assign(__remixContext.state.loaderData[${JSON.stringify(
              routeId
            )}], {${promiseKeyValues}});`;
          })
          .join('\n') +
        (deferredScripts.length > 0
          ? `__remixContext.a=${deferredScripts.length};`
          : '');

    let routeModulesScript = !isStatic
      ? ' '
      : `${
          manifest.hmr?.runtime
            ? `import ${JSON.stringify(manifest.hmr.runtime)};`
            : ''
        }import ${JSON.stringify(addPrefix(manifest.url, prefix))};
${matches
  .map(
    (match, index) =>
      `import * as route${index} from ${JSON.stringify(
        addPrefix(manifest.routes[match.route.id].module, prefix)
      )};`
  )
  .join('\n')}
window.__remixRouteModules = {${matches
          .map(
            (match, index) => `${JSON.stringify(match.route.id)}:route${index}`
          )
          .join(',')}};

import(${JSON.stringify(addPrefix(manifest.entry.module, prefix))});`;
    // 动态URL
    return (
      <>
        <script
          {...props}
          suppressHydrationWarning
          dangerouslySetInnerHTML={createHtml(contextScript)}
          type={undefined}
        />
        <script
          {...props}
          suppressHydrationWarning
          dangerouslySetInnerHTML={createHtml(routeModulesScript)}
          type="module"
          async
        />
      </>
    );
    // disabled deps array because we are purposefully only rendering this once
    // for hydration, after that we want to just continue rendering the initial
    // scripts as they were when the page first loaded
    // eslint-disable-next-line
  }, []);

  if (!isStatic && typeof __remixContext === 'object' && __remixContext.a) {
    for (let i = 0; i < __remixContext.a; i++) {
      deferredScripts.push(<DeferredHydrationScript key={i} />);
    }
  }

  // avoid waterfall when importing the next route module
  let nextMatches = useMemo(() => {
    if (navigation.location) {
      // FIXME: can probably use transitionManager `nextMatches`
      let matches = matchRoutes(router.routes, navigation.location);
      invariant(
        matches,
        `No routes match path "${navigation.location.pathname}"`
      );
      return matches;
    }

    return [];
  }, [navigation.location, router.routes]);

  let routePreloads = matches
    .concat(nextMatches)
    .map((match) => {
      let route = manifest.routes[match.route.id];
      return (route.imports || []).concat([route.module]);
    })
    .flat(1);

  let preloads = isHydrated ? [] : manifest.entry.imports.concat(routePreloads);

  return (
    <>
      <link
        rel="modulepreload"
        href={addPrefix(manifest.url, prefix)}
        crossOrigin={props.crossOrigin}
      />
      <link
        rel="modulepreload"
        href={addPrefix(manifest.entry.module, prefix)}
        crossOrigin={props.crossOrigin}
      />
      {dedupe(preloads).map((path) => (
        <link
          key={path}
          rel="modulepreload"
          href={addPrefix(path, prefix)}
          crossOrigin={props.crossOrigin}
        />
      ))}
      {!isHydrated && initialScripts}
      {!isHydrated && deferredScripts}
    </>
  );
}

function dedupe(array: any[]) {
  return [...new Set(array)];
}
