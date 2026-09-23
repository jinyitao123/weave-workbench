import { administrationApplication } from './packages/administration.js';
import { financeApplication } from './packages/finance.js';
import { productionApplication } from './packages/production.js';
import { projectApplication } from './packages/project.js';
import { reportsApplication } from './packages/reports.js';
import { salesApplication } from './packages/sales.js';
import { supplyChainApplication } from './packages/supply-chain.js';

export const forgeApplicationPackages = [
  supplyChainApplication,
  salesApplication,
  productionApplication,
  projectApplication,
  administrationApplication,
  financeApplication,
  reportsApplication,
];

export const forgeApplicationPlugins =
  forgeApplicationPackages.map((applicationPackage) => applicationPackage.plugin);

export {
  administrationApplication,
  financeApplication,
  productionApplication,
  projectApplication,
  reportsApplication,
  salesApplication,
  supplyChainApplication,
};
