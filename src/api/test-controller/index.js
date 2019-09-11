// TODO: Fix https://github.com/DevExpress/testcafe/issues/4139 to get rid of Pinkie
import Promise from 'pinkie';
import { identity, assign, isNil as isNullOrUndefined, flattenDeep as flatten } from 'lodash';
import { getCallsiteForMethod } from '../../errors/get-callsite';
import ClientFunctionBuilder from '../../client-functions/client-function-builder';
import Assertion from './assertion';
import { getDelegatedAPIList, delegateAPI } from '../../utils/delegated-api';

import {
    ClickCommand,
    RightClickCommand,
    DoubleClickCommand,
    HoverCommand,
    DragCommand,
    DragToElementCommand,
    TypeTextCommand,
    SelectTextCommand,
    SelectTextAreaContentCommand,
    SelectEditableContentCommand,
    PressKeyCommand,
    NavigateToCommand,
    SetFilesToUploadCommand,
    ClearUploadCommand,
    SwitchToIframeCommand,
    SwitchToMainWindowCommand,
    SetNativeDialogHandlerCommand,
    GetNativeDialogHistoryCommand,
    GetBrowserConsoleMessagesCommand,
    SetTestSpeedCommand,
    SetPageLoadTimeoutCommand
} from '../../test-run/commands/actions';

import {
    TakeScreenshotCommand,
    TakeElementScreenshotCommand,
    ResizeWindowCommand,
    ResizeWindowToFitDeviceCommand,
    MaximizeWindowCommand
} from '../../test-run/commands/browser-manipulation';

import { WaitCommand, DebugCommand } from '../../test-run/commands/observation';
import assertRequestHookType from '../request-hooks/assert-type';
import { createExecutionContext as createContext } from './execution-context';

import clientFunctionModeSwitcher from '../../client-functions/client-function-mode-switcher';

const originalThen = Promise.resolve().then;

let inDebug = false;

export default class TestController {
    constructor (testRun) {
        this._executionContext = null;

        this.testRun               = testRun;
        this.executionChain        = Promise.resolve();
        this.callsitesWithoutAwait = new Set();
    }

    static enableDebug () {
        inDebug = true;
    }

    static disableDebug () {
        inDebug = false;
    }

    shouldStop (command) {
        if (inDebug && command !== 'debug') {
            inDebug = false;
            return true;
        }

        if (command === 'debug')
            return true;

        return false;
    }

    // NOTE: we track missing `awaits` by exposing a special custom Promise to user code.
    // Action or assertion is awaited if:
    // a)someone used `await` so Promise's `then` function executed
    // b)Promise chained by using one of the mixed-in controller methods
    //
    // In both scenarios, we check that callsite that produced Promise is equal to the one
    // that is currently missing await. This is required to workaround scenarios like this:
    //
    // var t2 = t.click('#btn1'); // <-- stores new callsiteWithoutAwait
    // await t2;                  // <-- callsiteWithoutAwait = null
    // t.click('#btn2');          // <-- stores new callsiteWithoutAwait
    // await t2.click('#btn3');   // <-- without check it will set callsiteWithoutAwait = null, so we will lost tracking
    _createExtendedPromise (promise, callsite) {
        const extendedPromise     = promise.then(identity);
        const markCallsiteAwaited = () => this.callsitesWithoutAwait.delete(callsite);

        extendedPromise.then = function () {
            markCallsiteAwaited();

            return originalThen.apply(this, arguments);
        };

        delegateAPI(extendedPromise, TestController.API_LIST, {
            handler:     this,
            proxyMethod: markCallsiteAwaited
        });

        return extendedPromise;
    }

    _enqueueTask (apiMethodName, createTaskExecutor) {
        const callsite = getCallsiteForMethod(apiMethodName);
        const executor = createTaskExecutor(callsite);

        this.executionChain.then = originalThen;
        this.executionChain      = this.executionChain.then(executor);

        this.callsitesWithoutAwait.add(callsite);

        this.executionChain = this._createExtendedPromise(this.executionChain, callsite);

        return this.executionChain;
    }

    _enqueueCommand (apiMethodName, CmdCtor, cmdArgs) {
        return this._enqueueTask(apiMethodName, callsite => {
            let command = null;

            try {
                command = new CmdCtor(cmdArgs, this.testRun);
            }
            catch (err) {
                err.callsite = callsite;
                throw err;
            }

            return () => this.testRun.executeCommand(command, callsite);
        });
    }

    _enqueueCommandSync (apiMethodName, CmdCtor, cmdArgs) {
        const callsite = getCallsiteForMethod(apiMethodName);
        let command = null;

        try {
            command = new CmdCtor(cmdArgs, this.testRun);
        }
        catch (err) {
            err.callsite = callsite;
            throw err;
        }

        this.testRun.executeCommandSync(command, callsite);

        return this;
    }

    getExecutionContext () {
        if (!this._executionContext)
            this._executionContext = createContext(this.testRun);

        return this._executionContext;
    }

    // API implementation
    // We need implementation methods to obtain correct callsites. If we use plain API
    // methods in chained wrappers then we will have callsite for the wrapped method
    // in this file instead of chained method callsite in user code.
    _ctx$getter () {
        return this.testRun.testCtx;
    }

    _ctx$setter (val) {
        this.testRun.testCtx = val;

        return this.testRun.testCtx;
    }

    _fixtureCtx$getter () {
        return this.testRun.fixtureCtx;
    }

    _click$ (selector, options) {
        return this._enqueueCommandSync('click', ClickCommand, { selector, options });
    }

    _rightClick$ (selector, options) {
        return this._enqueueCommandSync('rightClick', RightClickCommand, { selector, options });
    }

    _doubleClick$ (selector, options) {
        return this._enqueueCommandSync('doubleClick', DoubleClickCommand, { selector, options });
    }

    _hover$ (selector, options) {
        return this._enqueueCommandSync('hover', HoverCommand, { selector, options });
    }

    _drag$ (selector, dragOffsetX, dragOffsetY, options) {
        return this._enqueueCommandSync('drag', DragCommand, { selector, dragOffsetX, dragOffsetY, options });
    }

    _dragToElement$ (selector, destinationSelector, options) {
        return this._enqueueCommandSync('dragToElement', DragToElementCommand, { selector, destinationSelector, options });
    }

    _typeText$ (selector, text, options) {
        return this._enqueueCommandSync('typeText', TypeTextCommand, { selector, text, options });
    }

    _selectText$ (selector, startPos, endPos, options) {
        return this._enqueueCommandSync('selectText', SelectTextCommand, { selector, startPos, endPos, options });
    }

    _selectTextAreaContent$ (selector, startLine, startPos, endLine, endPos, options) {
        return this._enqueueCommandSync('selectTextAreaContent', SelectTextAreaContentCommand, {
            selector,
            startLine,
            startPos,
            endLine,
            endPos,
            options
        });
    }

    _selectEditableContent$ (startSelector, endSelector, options) {
        return this._enqueueCommandSync('selectEditableContent', SelectEditableContentCommand, {
            startSelector,
            endSelector,
            options
        });
    }

    _pressKey$ (keys, options) {
        return this._enqueueCommandSync('pressKey', PressKeyCommand, { keys, options });
    }

    _wait$ (timeout) {
        return this._enqueueCommandSync('wait', WaitCommand, { timeout });
    }

    _navigateTo$ (url) {
        return this._enqueueCommandSync('navigateTo', NavigateToCommand, { url });
    }

    _setFilesToUpload$ (selector, filePath) {
        return this._enqueueCommandSync('setFilesToUpload', SetFilesToUploadCommand, { selector, filePath });
    }

    _clearUpload$ (selector) {
        return this._enqueueCommandSync('clearUpload', ClearUploadCommand, { selector });
    }

    _takeScreenshot$ (path) {
        return this._enqueueCommandSync('takeScreenshot', TakeScreenshotCommand, { path });
    }

    _takeElementScreenshot$ (selector, ...args) {
        const commandArgs = { selector };

        if (args[1]) {
            commandArgs.path    = args[0];
            commandArgs.options = args[1];
        }
        else if (typeof args[0] === 'object')
            commandArgs.options = args[0];
        else
            commandArgs.path = args[0];

        return this._enqueueCommandSync('takeElementScreenshot', TakeElementScreenshotCommand, commandArgs);
    }

    _resizeWindow$ (width, height) {
        return this._enqueueCommandSync('resizeWindow', ResizeWindowCommand, { width, height });
    }

    _resizeWindowToFitDevice$ (device, options) {
        return this._enqueueCommandSync('resizeWindowToFitDevice', ResizeWindowToFitDeviceCommand, { device, options });
    }

    _maximizeWindow$ () {
        return this._enqueueCommandSync('maximizeWindow', MaximizeWindowCommand);
    }

    _switchToIframe$ (selector) {
        return this._enqueueCommandSync('switchToIframe', SwitchToIframeCommand, { selector });
    }

    _switchToMainWindow$ () {
        return this._enqueueCommandSync('switchToMainWindow', SwitchToMainWindowCommand);
    }

    _eval$ (fn, options) {
        if (!isNullOrUndefined(options))
            options = assign({}, options, { boundTestRun: this });

        const builder  = new ClientFunctionBuilder(fn, options, { instantiation: 'eval', execution: 'eval' });
        const clientFn = builder.getFunction();

        return clientFn();
    }

    _setNativeDialogHandler$ (fn, options) {
        return this._enqueueCommandSync('setNativeDialogHandler', SetNativeDialogHandlerCommand, {
            dialogHandler: { fn, options }
        });
    }

    _getNativeDialogHistory$ () {
        const callsite = getCallsiteForMethod('getNativeDialogHistory');

        return this.testRun.executeCommandSync(new GetNativeDialogHistoryCommand(), callsite);
    }

    _getBrowserConsoleMessages$ () {
        const callsite = getCallsiteForMethod('getBrowserConsoleMessages');

        return this.testRun.executeCommandSync(new GetBrowserConsoleMessagesCommand(), callsite);
    }

    _expect$ (actual) {
        const callsite = getCallsiteForMethod('expect');

        return new Assertion(actual, this, callsite);
    }

    _setTestSpeed$ (speed) {
        return this._enqueueCommandSync('setTestSpeed', SetTestSpeedCommand, { speed });
    }

    _setPageLoadTimeout$ (duration) {
        return this._enqueueCommandSync('setPageLoadTimeout', SetPageLoadTimeoutCommand, { duration });
    }

    _useRole$ (role) {
        this.testRun.useRole(role);

        return this;
    }

    _addRequestHooks$ (...hooks) {
        hooks = flatten(hooks);

        assertRequestHookType(hooks);

        this.testRun.addRequestHooks(hooks);

        return this;
    }

    _removeRequestHooks$ (...hooks) {
        hooks = flatten(hooks);

        assertRequestHookType(hooks);

        this.testRun.removeRequestHooks(hooks);

        return this;
    }

    _debug$ () {
    }
}

TestController.API_LIST = getDelegatedAPIList(TestController.prototype);

delegateAPI(TestController.prototype, TestController.API_LIST, { useCurrentCtxAsHandler: true });
