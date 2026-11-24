import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type DocsSource, guidesSource } from '@entifix/docs-engine';
import {
  CAPABILITIES,
  type Capability,
  type Vertical,
  VERTICALS,
} from '@r10c/capabilities';

import { workspaceRoot } from './catalog';
import { docsCopy } from './copy';

export const GUIDES_FOLDER = 'guides';

/** The guides are written in Spanish, the language of the merchants they are for (Q26). */
export const GUIDES_LOCALE = 'es';

const DIRECTORY = join(workspaceRoot, 'apps/docs-site/content/guides');

/** A `:use-case[id]` citation, as the engine's directive reads it. */
const CITATION = /:use-case\[([^\]]+)\]/g;

export interface GuideFile {
  /** The file's name without `.md`: the vertical the guide is for. */
  readonly name: string;
  readonly markdown: string;
}

const readGuides = (): readonly GuideFile[] =>
  readdirSync(DIRECTORY)
    .filter(file => file.endsWith('.md'))
    .map(file => ({
      name: file.slice(0, -'.md'.length),
      markdown: readFileSync(join(DIRECTORY, file), 'utf8'),
    }));

const isVertical = (name: string): name is Vertical =>
  (VERTICALS as readonly string[]).includes(name);

const citesFor = (capability: Capability, vertical: Vertical) =>
  capability.verticals === 'all' || capability.verticals.includes(vertical);

/**
 * What a guide may cite (ADR 0080 §6). Each guide is named for its vertical,
 * and a use case that declares other verticals is not something that vertical
 * does — the device filter in a hardware guide, say. An unknown id is the
 * engine's to refuse; this refuses the id that exists but does not apply.
 */
export const guideProblems = (
  guides: readonly GuideFile[],
  capabilities: readonly Capability[] = CAPABILITIES,
): readonly string[] =>
  guides.flatMap(({ name, markdown }) => {
    if (!isVertical(name)) {
      return [
        `guides/${name}.md is named for no vertical (${VERTICALS.join(', ')})`,
      ];
    }
    return [...markdown.matchAll(CITATION)].flatMap(([, id = '']) => {
      const capability = capabilities.find(entry => entry.id === id);
      return capability !== undefined && !citesFor(capability, name)
        ? [
            `guides/${name}.md cites '${id}', which is for ${(capability.verticals as readonly string[]).join(', ')}, not ${name}`,
          ]
        : [];
    });
  });

/** The vertical guides, refused at build when one cites what its vertical does not do. */
export const verticalGuidesSource = (): DocsSource => {
  const problems = guideProblems(readGuides());
  if (problems.length > 0) {
    throw new Error(`docs-site: ${problems.join('; ')}`);
  }
  return guidesSource({
    directory: DIRECTORY,
    folder: GUIDES_FOLDER,
    title: docsCopy(GUIDES_LOCALE).guides.title,
  });
};
