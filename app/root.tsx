import { cssBundleHref } from '@remix-run/css-bundle';
import type { LinksFunction, LoaderFunction } from '@remix-run/node';
import {
  // Links,
  LiveReload,
  Meta,
  Outlet,
  // Scripts,
  ScrollRestoration,
  useLoaderData,
} from '@remix-run/react';
import { Scripts } from '~/components/Scripts';
import { Links } from '~/components/Links';

export const links: LinksFunction = () => [
  ...(cssBundleHref ? [{ rel: 'stylesheet', href: cssBundleHref }] : []),
];

export const loader: LoaderFunction = ({ request, context }) => {
  // form express's getLoadContext
  return {
    dynamicHost: context?.dynamicHost,
  };
};

export default function App() {
  const { dynamicHost } = useLoaderData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links prefix={dynamicHost} />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts prefix={dynamicHost} />
        <LiveReload />
      </body>
    </html>
  );
}
