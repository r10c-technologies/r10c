import { describeFlowStarterContract } from './flow-starter.contract.js';
import { makeScriptedFlowStarter } from './scripted-flow-starter.js';

describeFlowStarterContract(
  'the scripted flow starter',
  makeScriptedFlowStarter,
);
