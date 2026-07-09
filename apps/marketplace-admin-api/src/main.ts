/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import cors from 'cors';
import express from 'express';
import * as path from 'path';

import { productBrandTempData } from './product-brand-temp-data';
import { productCategoryTempData } from './product-category-temp-data';
import { productTempData } from './product-temp-data';

/**
 * Paginates an in-memory array the way the REST load adapter expects
 * (`items` / `total` / `request`).
 */
function paginate<T>(data: T[], query: Record<string, unknown>) {
  const page = Number(query.page) || 1;
  const pageSize = Number(query.pageSize) || 10;
  const start = (page - 1) * pageSize;
  return {
    items: data.slice(start, start + pageSize),
    total: data.length,
    request: { page, pageSize },
  };
}

const app = express();

// The browser-side REST adapter calls this API cross-origin (from the Next app
// on :3000), so permissive CORS is required while this is a dev-only mock.
app.use(cors());

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to @r10c/marketplace-admin-api!' });
});

app.get('/api/product-category', (req, res) => {
  res.send(paginate(productCategoryTempData, req.query));
});

// Single category by id — used when a product's category foreign-key link is
// resolved (reloaded) through the link resolver.
app.get('/api/product-category/:id', (req, res) => {
  const category = productCategoryTempData.find(
    item => item.id === req.params.id,
  );
  if (!category) {
    res.status(404).send({ message: 'Product category not found' });
    return;
  }
  res.send(category);
});

app.get('/api/product-brand', (req, res) => {
  res.send(paginate(productBrandTempData, req.query));
});

app.get('/api/product-brand/:id', (req, res) => {
  const brand = productBrandTempData.find(item => item.id === req.params.id);
  if (!brand) {
    res.status(404).send({ message: 'Product brand not found' });
    return;
  }
  res.send(brand);
});

app.get('/api/product', (req, res) => {
  res.send(paginate(productTempData, req.query));
});

app.get('/api/product/:id', (req, res) => {
  const product = productTempData.find(item => item.id === req.params.id);
  if (!product) {
    res.status(404).send({ message: 'Product not found' });
    return;
  }
  res.send(product);
});

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
