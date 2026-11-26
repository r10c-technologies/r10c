import { EntityRepositoryFactoryTag } from '@entifix/business';
import { Effect } from 'effect';

import { ProductSpecification } from '../../entities/product-specification';

/** The most offerings one product's variants are read in, siblings included. */
export const VARIANT_SIBLINGS_PAGE = 500;

/**
 * The series a specification version belongs to: its `specKey`, or its own
 * id when it predates versioning and has none.
 */
export const seriesOf = (organizationId: string, specificationId: string) =>
  Effect.gen(function* () {
    const factory = yield* EntityRepositoryFactoryTag;
    const specifications = yield* factory.for(ProductSpecification, {
      organizationId,
    });
    const specification =
      yield* specifications.get<ProductSpecification>(specificationId);
    return specification.specKey ?? String(specification.id);
  });

/** Every version id of a series, which is what an offering pins. */
export const versionsOf = (organizationId: string, series: string) =>
  Effect.gen(function* () {
    const factory = yield* EntityRepositoryFactoryTag;
    const specifications = yield* factory.for(ProductSpecification, {
      organizationId,
    });
    const page = yield* specifications.load<ProductSpecification>({
      filtering: [{ property: 'specKey', operator: 'eq', value: series }],
      pageSize: VARIANT_SIBLINGS_PAGE,
    });
    return [series, ...page.items.map(one => String(one.id))];
  });
