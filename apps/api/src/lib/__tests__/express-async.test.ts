import type { NextFunction, Request, Response } from 'express';

import { asyncRoute } from '../express-async';

const req = {} as Request;
const res = {} as Response;

describe('asyncRoute', () => {
  it('runs the handler and does not call next when it resolves', async () => {
    const next = jest.fn() as unknown as NextFunction;
    const handler = jest.fn().mockResolvedValue('done');

    asyncRoute(handler)(req, res, next);
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes a rejection to next', async () => {
    const next = jest.fn();
    const failure = new Error('boom');

    asyncRoute(() => Promise.reject(failure))(req, res, next as unknown as NextFunction);
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith(failure);
  });
});
