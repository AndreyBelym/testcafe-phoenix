// TODO: Fix https://github.com/DevExpress/testcafe/issues/4139 to get rid of Pinkie
import Promise from 'pinkie';
import { noop } from 'lodash';
import testRunTracker from '../api/test-run-tracker';

export default class ReExecutablePromise {
    constructor (executorFn) {
        this._fn     = executorFn;
        this._executed = false;
        this._result = null;
        this._error = null;
    }

    _ensureExecuting () {
        if (this._executed)
            return;

        this._result = null;
        this._error = null;

        try {
            this._result = this._fn()
        }
        catch (error) {
            this._error = error;
        }
    }

    _reExecute () {
        this._executed = false;

        return this._execute();
    }

    _execute () {
        this._ensureExecuting();

        if (this._error) 
            throw this._error;

        return this._result;
    }

    then (onFulfilled, onRejected) {
        this._ensureExecuting();

        try {
            if (this._error) 
                return Promise.resolve(onRejected(this._error));
            
            return Promise.resolve(onFulfilled(this._result));
        } catch (e) {
            return Promise.reject(e);
        }
    }

    catch (onRejected) {
        return this.then(() => {}, onRejected);
    }

    static fromFn (asyncExecutorFn) {
        const testRunId = testRunTracker.getContextTestRunId();

        if (testRunId)
            asyncExecutorFn = testRunTracker.addTrackingMarkerToFunction(testRunId, asyncExecutorFn);

        return new ReExecutablePromise(asyncExecutorFn);
    }
}
