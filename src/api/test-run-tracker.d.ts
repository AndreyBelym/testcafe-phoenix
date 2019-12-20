export interface TestRun {
    id: string;
    executeCommand(command: unknown, callsite: unknown): Promise<unknown>;
}

export interface TestRunTracker {
    activeTestRuns: { [id: string]: TestRun };
}

declare const testRunTracker: TestRunTracker;

export default testRunTracker;

