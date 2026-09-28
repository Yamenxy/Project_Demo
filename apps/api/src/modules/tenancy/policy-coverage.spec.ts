import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { ROUTE_POLICY } from '../../common/policy';

/**
 * REQ-RBAC-005: every endpoint declares an access policy. This fails the build for any route
 * added without one (the guard would also refuse it at runtime).
 */
describe('route policy coverage', () => {
  it('every route in the application declares a policy', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const reflector = new Reflector();
    const routes: string[] = [];
    const missing: string[] = [];

    for (const module of moduleRef.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
        if (!controller) continue;
        const prototype = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          const path = `${controller.name}.${name} (${String(Reflect.getMetadata(PATH_METADATA, handler))})`;
          routes.push(path);
          const policy: unknown = reflector.getAllAndOverride(ROUTE_POLICY, [
            handler as () => void,
            controller,
          ]);
          if (!policy) missing.push(path);
        }
      }
    }

    await moduleRef.close();
    expect(routes.length).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
