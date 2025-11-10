import { TempClass } from '@r10c/entifix-ts-core';

function TestPage() {

    const tempInstance = new TempClass();

    return <div>Test Page
        <p>{JSON.stringify(tempInstance)}</p>
    </div>;
}
export default TestPage;