/**
 * Catalog ownership: the module that authors a string owns its catalog entry
 * and resolves it.
 *
 * `app` is the apps' namespace. A shell or an entifix package that binds to it
 * is authoring copy on an app's behalf — or worse, as `ACCOUNT_DESTINATIONS`
 * once did, holding a key out of *one* app's sub-tree (`app:auth.account.*`)
 * and handing it to whichever app happens to render the component, so
 * marketplace-admin-app resolved auth-app's copy to draw its own menu. Both
 * apps are one host now, but the rule is what keeps a shell's copy in `shell:`
 * where a second host can reach it.
 *
 * Shell chrome belongs in `shell`, agnostic UI copy in `controls`. Where a
 * shell must render copy an app authors — its nav labels, its URL segments —
 * the app passes a resolved **string**, not a key.
 *
 * A dedicated rule rather than `no-restricted-syntax`, which `@nx/eslint-plugin`
 * also sets: project configs spread `nx.configs['flat/*']` *after* the root
 * config, and flat config replaces rule options wholesale, so a root-declared
 * `no-restricted-syntax` is silently overwritten in exactly the packages this
 * needs to cover.
 *
 * Scoping is done here, on the absolute path, for the same reason the
 * `jsx-no-literals` block is glob-only: Nx runs `eslint` from each project's own
 * directory, so a workspace-rooted `files: ['apps/**']` matches nothing.
 */

const BINDERS = new Set([
  'useT',
  'getServerT',
  'getServerTFor',
  'getServerTranslateKey',
]);

const GUIDANCE =
  'Shell chrome belongs in `shell`, agnostic UI copy in `controls`; copy an app authors reaches the shell as a resolved string, not a key. See docs/I18N.md.';

/** @type {import('eslint').Rule.RuleModule} */
export const noForeignAppNamespace = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid the `app` i18n namespace outside apps/, which owns it.',
    },
    schema: [],
    messages: {
      binder: 'Do not bind the `app` namespace outside apps/. ' + GUIDANCE,
      key: 'Do not reference the `app:`-qualified key "{{key}}" outside apps/. ' + GUIDANCE,
    },
  },

  create(context) {
    // An app is free to use its own namespace; everything else is not.
    if (/[\\/]apps[\\/]/.test(context.filename)) return {};

    return {
      CallExpression(node) {
        const [first] = node.arguments;
        if (
          node.callee.type === 'Identifier' &&
          BINDERS.has(node.callee.name) &&
          first?.type === 'Literal' &&
          first.value === 'app'
        ) {
          context.report({ node: first, messageId: 'binder' });
        }
      },

      Literal(node) {
        if (typeof node.value === 'string' && node.value.startsWith('app:')) {
          context.report({ node, messageId: 'key', data: { key: node.value } });
        }
      },
    };
  },
};

/** The plugin object, registered as `r10c` in the root flat config. */
export const r10cPlugin = {
  rules: { 'no-foreign-app-namespace': noForeignAppNamespace },
};
