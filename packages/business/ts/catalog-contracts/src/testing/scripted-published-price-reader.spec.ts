import { describePublishedPriceReaderContract } from './published-price-reader.contract.js';
import { makeScriptedPublishedPriceReader } from './scripted-published-price-reader.js';

describePublishedPriceReaderContract(
  'the scripted reader',
  makeScriptedPublishedPriceReader,
);
