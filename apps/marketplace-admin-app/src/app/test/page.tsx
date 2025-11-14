import { ProductCategory } from '@r10c/business-ts-product-configuration-management';


function TestPage() {

  const category = new ProductCategory();

  return <div>Test Page
    <pre>{JSON.stringify(category)}</pre>
  </div>;
}

export default TestPage;
