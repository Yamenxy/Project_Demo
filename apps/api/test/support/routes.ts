import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { ROUTE_POLICY, type RoutePolicy } from '../../src/common/policy';

export interface RouteInfo {
  method: string;
  /** Full path under /api, with :params. */
  path: string;
  params: string[];
  policy: RoutePolicy | undefined;
  name: string;
}

function joinPath(...parts: unknown[]): string {
  const segments = parts
    .flatMap((part): unknown[] => (Array.isArray(part) ? (part as unknown[]) : [part]))
    .map((part) => String(part ?? '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  return `/${segments.join('/')}`;
}

/** Every HTTP route registered in the application, with its declared access policy. */
export function listRoutes(app: INestApplicationContext): RouteInfo[] {
  const reflector = new Reflector();
  const routes: RouteInfo[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!controller) continue;
      const prefix: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const path = joinPath('api', prefix, Reflect.getMetadata(PATH_METADATA, handler));
        routes.push({
          method: RequestMethod[method as RequestMethod],
          path,
          params: [...path.matchAll(/:(\w+)/g)].map((m) => m[1] ?? ''),
          policy: reflector.getAllAndOverride(ROUTE_POLICY, [handler as () => void, controller]),
          name: `${controller.name}.${name}`,
        });
      }
    }
  }
  return routes;
}

export function fillPath(path: string, values: Record<string, string>): string {
  return path.replace(/:(\w+)/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No fixture value for route parameter :${name}`);
    return encodeURIComponent(value);
  });
}
