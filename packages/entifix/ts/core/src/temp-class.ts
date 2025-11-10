import { TempAnnotation } from './temp-annotation';


@TempAnnotation()
export class TempClass {
    tempValue = 'Temporary Class Value';

    constructor() {
        console.log('TempClass instance created');
    }
}