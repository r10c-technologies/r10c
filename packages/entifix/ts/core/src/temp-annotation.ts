export function TempAnnotation() {
    return function <T extends { new(...args: any[]): {} }>(constructor: T) {
        console.log('[] TempAnnotation applied to - update', constructor.name);
        return class extends constructor {
            annotated = true;
        };
    };
}