import path from 'path';
import url from 'url';
import { spawn } from 'child_process';
import { join } from 'path';
import { getFreePort } from 'endpoint-utils';
import cri from 'chrome-remote-interface';
import testRunTracker from '../../api/test-run-tracker';
import RequestHookProxy from './request-hook-proxy';
import Transmitter from './transmitter';
import EE from '../../utils/async-event-emitter';
import { UseRoleCommand } from '../../test-run/commands/actions';
import { createRole } from '../../role';
import { DebugCommand } from '../../test-run/commands/observation';

const INTERNAL_FILES_URL = url.pathToFileURL(path.join(__dirname, '../../'));

class ParentTransport extends EE {
    constructor (cp) {
        super();

        this.cp = cp;
    }
    read () {
        this.cp.stdio[4].on('data', data => {
            this.emit('data', data);
        });
    }

    async write (data, { syncChannel } = {}) {
        const channel = syncChannel ? 5 : 3;

        return new Promise((resolve, reject) => {
            this.cp.stdio[channel].write(data, error => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    }
}

export default class CompilerProcess extends EE {
    constructor (v8Flags) {
        super();

        this.v8Flags = v8Flags || [];

        this.debugInfo = null;
        this.cp = null;
        this.cri = null;
        this.transmitter = null;
    }

    async _getDebugInfo (v8Flags) {
        const debugInfo = { host: '127.0.0.1', port: '', isDefault: true, stopOnStart: false };

        const inspectFlags = v8Flags.filter(flag => flag.startsWith('--inspect'));
        const inspectFlag  = inspectFlags[0];

        if (!inspectFlag) {
            debugInfo.port = String(await getFreePort());

            return debugInfo;
        }

        debugInfo.isDefault = false;
        debugInfo.stopOnStart = inspectFlag.includes('brk');

        const inspectFlagParsed = inspectFlag.match(/=([^:\d]*)?:?(\d+)?$/);

        if (inspectFlagParsed) {
            debugInfo.host = inspectFlagParsed[1] || debugInfo.host;
            debugInfo.port = inspectFlagParsed[2] || debugInfo.port;
        }
        else
            debugInfo.port = '9229';

        return debugInfo;
    }

    _setupRoutes () {
        this.transmitter.on('test-file-added', ({ filename }) => this.emit('test-file-added', filename));

        this.transmitter.on('debug', () => this.stopTests());

        this.transmitter.on('execute-command', data => {
            if (!testRunTracker.activeTestRuns[data.id])
                return void 0;

            return testRunTracker
                .activeTestRuns[data.id]
                .executeCommand(data.command);
        });

        this.transmitter.on('use-role', data => {
            if (!testRunTracker.activeTestRuns[data.id])
                return void 0;

            const testRun = testRunTracker
                .activeTestRuns[data.id];

            const command = new UseRoleCommand({
                role: createRole(
                    data.role.id,
                    data.role.loginPage,
                    data.role.initFn && (run => this.runTest(data.role.id, 'roles', run.id, 'initFn') ),
                    data.role.options
                )
            });

            return testRun
                .executeCommand(command);
        });

        this.transmitter.on('add-request-hooks', data => {
            if (!testRunTracker.activeTestRuns[data.id])
                return;

            const testRun = testRunTracker
                .activeTestRuns[data.id];

            data.hooks.forEach(hook => testRun.addRequestHook(new RequestHookProxy(this.transmitter, hook)));
        });

        this.transmitter.on('remove-request-hooks', data => {
            if (!testRunTracker.activeTestRuns[data.id])
                return;

            const testRun = testRunTracker
                .activeTestRuns[data.id];

            data.hooks.forEach(hook => {
                testRun.removeRequestHook(testRun.requestHooks[hook.id]);
            });
        });
    }

    _setupDebuggerHandlers () {
        this.cri.on('Debugger.paused', ({callFrames}) => {
            Object.values(testRunTracker.activeTestRuns).forEach(testRun => {
                if (!testRun.debugging)
                    testRun.executeCommand(new DebugCommand())
            });
            if (callFrames[0].url.indexOf(INTERNAL_FILES_URL) >= 0)
                 this.cri.Debugger.stepOut();
        });

        this.cri.on('Debugger.resumed', () => {
            Object.values(testRunTracker.activeTestRuns).forEach(testRun => {
                testRun.debugging = false;
            });
        });

        this.cri.on('Target.attachedToTarget', result => {
            console.log('attached', result);
        });
    }

    async init () {
        this.debugInfo = await this._getDebugInfo(this.v8Flags);

        this.cp = spawn(process.argv0, [ `--inspect-brk=${this.debugInfo.host}:${this.debugInfo.port}`, ...this.v8Flags, join(__dirname, 'child.js')], { stdio: [0, 1, 2, 'pipe', 'pipe', 'pipe'] });

        this.transmitter = new Transmitter(new ParentTransport(this.cp));

        this._setupRoutes();

        await new Promise(r => setTimeout(r, 2000));

        this.cri = await cri({ port: this.debugInfo.port });

        this._setupDebuggerHandlers();

        await this.cri.Debugger.enable();

        await this.cri.Runtime.enable();

        await this.cri.Runtime.runIfWaitingForDebugger();

        await this.cri.Debugger.paused();

        // const { result: debugFunction } = await this.cri.Runtime.evaluate({ expression: `global.process.mainModule.require('../../api/test-controller').prototype.debug` });
        //
        // console.log(debugFunction);
        //
        // console.log(await this.cri.Debugger.setBreakpointOnFunctionCall({ objectId: debugFunction.objectId }));
    }

    async getTests (sources) {
        const tests = await this.transmitter.send('get-tests', sources);

        const fixtures = [];

        tests.forEach(test => {
            if (!fixtures.some(fixture => fixture.id === test.fixture.id))
                fixtures.push(test.fixture);

            test.fn = testRun => this
                .runTest(test.id, 'tests', testRun.id, 'fn');

            if (test.beforeFn) {
                test.beforeFn = testRun => this
                    .runTest(test.id, 'tests', testRun.id, 'beforeFn');
            }

            if (test.afterFn) {
                test.afterFn = testRun => this
                    .runTest(test.id, 'tests', testRun.id, 'afterFn');
            }

            test.requestHooks = test.requestHooks.map(hook => new RequestHookProxy(this.transmitter, hook));
        });

        fixtures.forEach(fixture => {
            if (fixture.beforeEachFn) {
                fixture.beforeEachFn = testRun => this
                    .runTest(fixture.id, 'fixtures', testRun.id, 'beforeEachFn');
            }

            if (fixture.afterEachFn) {
                fixture.afterEachFn = testRun => this
                    .runTest(fixture.id, 'fixtures', testRun.id, 'afterEachFn');
            }

            if (fixture.beforeFn) {
                fixture.beforeFn = () => this
                    .runTest(fixture.id, 'fixtures', null, 'beforeFn');
            }

            if (fixture.afterFn) {
                fixture.afterFn = () => this
                    .runTest(fixture.id, 'fixtures', null, 'afterFn');
            }
        });

        return tests;
    }

    async pauseTests () {

    }

    async runTest (idx, actor, testRunId, func) {
        return await this.transmitter.send('run-test', { idx, actor, func, testRunId });
    }

    async cleanUp () {
        await this.transmitter.send('clean-up');
    }

    async stop () {
        return await this.transmitter.send('exit');
    }
}
