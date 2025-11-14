/* eslint-disable @typescript-eslint/no-unsafe-function-type */

export interface ClassDecoratorContext {
  kind: string;
  name?: string;
  addInitializer(initializer: () => void): void;
  metadata?: Record<string, unknown>;
}

export type ClassDecorator<T> = (value: T, context: ClassDecoratorContext) => T;

export interface MethodDecoratorContext {
  kind: string;
  name: string | symbol;
  static: boolean;
  private: boolean;
  addInitializer(initializer: () => void): void;
  metadata?: Record<string, unknown>;
  access: { get: Function };
}

export type MethodDecorator = (
  value: Function,
  context: MethodDecoratorContext
) => void;

export interface GetterDecoratorContext {
  kind: string;
  name: string | symbol;
  static: boolean;
  private: boolean;
  addInitializer(initializer: () => void): void;
  metadata?: Record<string, unknown>;
  access: { get: Function };
}

export interface SetterDecoratorContext {
  kind: string;
  name: string | symbol;
  static: boolean;
  private: boolean;
  addInitializer(initializer: () => void): void;
  metadata?: Record<string, unknown>;
  access: { set: Function };
}

export type AccessorDecorator = (
  value: Function,
  context: GetterDecoratorContext | SetterDecoratorContext
) => void;
