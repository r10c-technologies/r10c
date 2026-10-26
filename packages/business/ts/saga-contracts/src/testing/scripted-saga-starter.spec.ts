import { describeSagaStarterContract } from './saga-starter.contract.js';
import { makeScriptedSagaStarter } from './scripted-saga-starter.js';

describeSagaStarterContract('the scripted starter', makeScriptedSagaStarter);
