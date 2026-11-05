/**
 * The configuration list's path, in a module with no `'use client'`
 * directive. It lived in the list's client page, and a server module importing
 * a value from a client module receives a client reference rather than the
 * string — so the sidebar item built from it carried no usable `href`, and the
 * first server code to read it as a string threw (#531).
 */
export const CONFIGURATION_LIST_HREF = '/system/configuration';
