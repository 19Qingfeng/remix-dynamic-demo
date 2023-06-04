import { useContext, useMemo } from 'react';
import { PrefetchPageLinks, UNSAFE_RemixContext } from '@remix-run/react';
import { UNSAFE_DataRouterStateContext } from 'react-router-dom';
import type {
  LinkDescriptor,
  PrefetchPageDescriptor,
} from '@remix-run/react/dist/links';
import type { RouteModules } from '@remix-run/react/dist/routeModules';
import type { AssetsManifest } from '@remix-run/dev';
import type { AgnosticDataRouteMatch } from '@remix-run/router';
import React from 'react';

function dedupeHrefs(hrefs: string[]): string[] {
  return [...new Set(hrefs)];
}

////////////////////////////////////////////////////////////////////////////////
export function isPageLinkDescriptor(
  object: any
): object is PrefetchPageDescriptor {
  return object != null && typeof object.page === 'string';
}

// The `<Script>` will render rel=modulepreload for the current page, we don't
// need to include them in a page prefetch, this gives us the list to remove
// while deduping.
function getCurrentPageModulePreloadHrefs(
  matches: AgnosticDataRouteMatch[],
  manifest: AssetsManifest
): string[] {
  return dedupeHrefs(
    matches
      .map((match) => {
        let route = manifest.routes[match.route.id];
        let hrefs = [route.module];

        if (route.imports) {
          hrefs = hrefs.concat(route.imports);
        }

        return hrefs;
      })
      .flat(1)
  );
}

export function dedupe(descriptors: LinkDescriptor[], preloads: string[]) {
  let set = new Set();
  let preloadsSet = new Set(preloads);

  return descriptors.reduce((deduped, descriptor) => {
    let alreadyModulePreload =
      !isPageLinkDescriptor(descriptor) &&
      descriptor.as === 'script' &&
      descriptor.href &&
      preloadsSet.has(descriptor.href);

    if (alreadyModulePreload) {
      return deduped;
    }
    // @ts-ignore
    let str = JSON.stringify(descriptor);
    if (!set.has(str)) {
      set.add(str);

      deduped.push(descriptor);
    }

    return deduped;
  }, [] as LinkDescriptor[]);
}

/**
 * Gets all the links for a set of matches. The modules are assumed to have been
 * loaded already.
 */
export function getLinksForMatches(
  matches: AgnosticDataRouteMatch[],
  routeModules: RouteModules,
  manifest: AssetsManifest,
  prefix: string = ''
): LinkDescriptor[] {
  // 获得当前所有页面匹配的 Links
  let descriptors = matches
    .map((match): LinkDescriptor[] => {
      let module = routeModules[match.route.id];
      // links 处理
      let links = module.links?.() || [];

      // 非 pageLink
      links.forEach((link) => {
        if (!isPageLinkDescriptor(link)) {
          let { href, rel } = link;
          // 样式文件处理
          if (rel === 'stylesheet' && link.href) {
            link.href = prefix + href;
          }
        }
      });

      return module.links?.() || [];
    })
    .flat(1);
  // 获取所有匹配的 Utils href
  let preloads = getCurrentPageModulePreloadHrefs(matches, manifest);
  return dedupe(descriptors, preloads);
}

/**
 * Renders the `<link>` tags for the current routes.
 * 1. 支持 prefix 动态 CND 参数
 * @see https://remix.run/components/links
 */
export function Links(props: { prefix?: string }) {
  let { prefix } = props;
  let remixContext = useContext(UNSAFE_RemixContext);
  let routerState = useContext(UNSAFE_DataRouterStateContext);
  const { matches } = routerState || {};
  const { manifest, routeModules } = remixContext || {};

  // 获取匹配的 links
  let links = useMemo(
    // @ts-ignore TODO: 类型后续处理
    () => getLinksForMatches(matches, routeModules, manifest, prefix),
    [matches, routeModules, manifest, prefix]
  );

  // parseLinks
  links.forEach((link) => {
    // 仅仅处理了css文件
    if (!isPageLinkDescriptor(link)) {
      const { rel, href } = link;
      if (rel === 'stylesheet') link.href = prefix ? prefix + href : href;
    } else {
      const { page } = link;
      if (page) {
        link.page = prefix ? prefix + page : page;
      }
    }
  });

  return (
    <>
      {links.map((link) => {
        if (isPageLinkDescriptor(link)) {
          // TODO: 组件拿出来 内置还是存在依赖
          return <PrefetchPageLinks key={link.page} {...link} />;
        }

        let imageSrcSet: string | null = null;

        // In React 17, <link imageSrcSet> and <link imageSizes> will warn
        // because the DOM attributes aren't recognized, so users need to pass
        // them in all lowercase to forward the attributes to the node without a
        // warning. Normalize so that either property can be used in Remix.
        if ('useId' in React) {
          if (link.imagesrcset) {
            link.imageSrcSet = imageSrcSet = link.imagesrcset;
            delete link.imagesrcset;
          }

          if (link.imagesizes) {
            link.imageSizes = link.imagesizes;
            delete link.imagesizes;
          }
        } else {
          if (link.imageSrcSet) {
            link.imagesrcset = imageSrcSet = link.imageSrcSet;
            delete link.imageSrcSet;
          }

          if (link.imageSizes) {
            link.imagesizes = link.imageSizes;
            delete link.imageSizes;
          }
        }

        return (
          <link
            key={link.rel + (link.href || '') + (imageSrcSet || '')}
            {...link}
          />
        );
      })}
    </>
  );
}
