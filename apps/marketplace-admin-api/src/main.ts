/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import cors from 'cors';
import express from 'express';
import * as path from 'path';

import { productCategoryTempData } from './product-category-temp-data';

const app = express();

// The browser-side REST adapter calls this API cross-origin (from the Next app
// on :3000), so permissive CORS is required while this is a dev-only mock.
app.use(cors());

app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/api', (req, res) => {
  res.send({ message: 'Welcome to @r10c/marketplace-admin-api!' });
});

app.get('/api/product-category', (req, res) => {
  const page = Number(req.query.page) || 1;
  const pageSize = Number(req.query.pageSize) || 10;
  const start = (page - 1) * pageSize;
  const items = productCategoryTempData.slice(start, start + pageSize);

  res.send({
    items,
    total: productCategoryTempData.length,
    request: { page, pageSize },
  });
});

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
