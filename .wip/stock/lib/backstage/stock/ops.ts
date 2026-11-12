/**
 * Stock: every operation the area has, in one place to import from.
 *
 *   picture.ts          what is ready to sell, and what wants a person
 *   batches.ts          a run of making: list, open, plan, correct
 *   batch-states.ts     made, released, closed, recalled
 *   recall-list.ts      who has shots from a batch
 *   hand-movements.ts   samples, waste and corrections after a count
 *   order-stock.ts      which batch each order was filled from
 *   suppliers.ts        who things are bought from
 *   materials.ts        bottles, caps, labels, cartons
 *   purchasing.ts       purchase orders: start one, fill it in
 *   purchase-states.ts  sent, received, cancelled
 *
 * Stock is counted in shots, by batch, and is never edited: every change is
 * a movement and what is on hand is the sum (movements.ts). Filling orders
 * from batches is in allocation.ts. The two state machines are written down
 * once, in status.ts.
 */

import {
  closeBatch,
  recallBatch,
  recordMade,
  releaseBatch,
} from "./batch-states";
import {
  getBatch,
  listBatches,
  planBatch,
  suggestBatchCode,
  updateBatch,
} from "./batches";
import { adjustCount, recordSample, recordWaste } from "./hand-movements";
import {
  adjustMaterial,
  createMaterial,
  getMaterial,
  listMaterials,
  updateMaterial,
} from "./materials";
import {
  listOrdersWithoutBatch,
  orderStock,
  recordOrderBatch,
} from "./order-stock";
import { stockAvailable, stockPicture } from "./picture";
import {
  cancelPurchaseOrder,
  markPurchaseReceived,
  markPurchaseSent,
} from "./purchase-states";
import {
  addPurchaseLine,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  removePurchaseLine,
  updatePurchaseOrder,
} from "./purchasing";
import { recallList } from "./recall-list";
import {
  createSupplier,
  getSupplier,
  listSuppliers,
  setSupplierActive,
  updateSupplier,
} from "./suppliers";

export {
  addPurchaseLine,
  adjustCount,
  adjustMaterial,
  cancelPurchaseOrder,
  closeBatch,
  createMaterial,
  createPurchaseOrder,
  createSupplier,
  getBatch,
  getMaterial,
  getPurchaseOrder,
  getSupplier,
  listBatches,
  listMaterials,
  listOrdersWithoutBatch,
  listPurchaseOrders,
  listSuppliers,
  markPurchaseReceived,
  markPurchaseSent,
  orderStock,
  planBatch,
  recallBatch,
  recallList,
  recordMade,
  recordOrderBatch,
  recordSample,
  recordWaste,
  releaseBatch,
  removePurchaseLine,
  setSupplierActive,
  stockAvailable,
  stockPicture,
  suggestBatchCode,
  updateBatch,
  updateMaterial,
  updatePurchaseOrder,
  updateSupplier,
};

export type {
  BatchDetail,
  BatchOrderRow,
  BatchSummary,
  MovementRow,
} from "./batches";
export type { HandMovementResult } from "./hand-movements";
export type { MaterialDetail, MaterialRow } from "./materials";
export type { OrderStock, UnrecordedOrder } from "./order-stock";
export type {
  AttentionItem,
  Availability,
  PictureBatch,
  StockPicture,
} from "./picture";
export type { ReceivedMaterial } from "./purchase-states";
export type { PurchaseDetail, PurchaseLine, PurchaseRow } from "./purchasing";
export type {
  RecallList,
  RecallNoteLine,
  RecallRow,
} from "./recall-list";
export type { SupplierDetail, SupplierRow } from "./suppliers";

/**
 * Every stock operation, for anything that wants to offer them all by name
 * (the MCP connection, a script). The order is the order a person meets
 * them in: the picture, batches, the shelf, then buying things in.
 */
export const STOCK_OPS = [
  stockPicture,
  stockAvailable,
  listBatches,
  getBatch,
  suggestBatchCode,
  planBatch,
  updateBatch,
  recordMade,
  releaseBatch,
  closeBatch,
  recallBatch,
  recallList,
  recordSample,
  recordWaste,
  adjustCount,
  orderStock,
  recordOrderBatch,
  listOrdersWithoutBatch,
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  setSupplierActive,
  listMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
  adjustMaterial,
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  addPurchaseLine,
  removePurchaseLine,
  markPurchaseSent,
  markPurchaseReceived,
  cancelPurchaseOrder,
] as const;
