import chalk from 'chalk';
import Promise from 'pinkie';
import { partition } from 'lodash';
import { GeneralError, APIError, CompositeError } from '../errors/runtime';
import MESSAGE from '../errors/runtime/message';
import CliArgumentParser from './argument-parser';
import TerminationHandler from './termination-handler';
import log from './log';
import OPTION_NAMES from '../configuration/option-names';
import remotesWizard from './remotes-wizard';
import createTestCafe from '../';

// NOTE: Load the provider pool lazily to reduce startup time
const lazyRequire         = require('import-lazy')(require);
const browserProviderPool = lazyRequire('../browser/provider/pool');

let showMessageOnExit = true;
let exitMessageShown  = false;
let exiting           = false;

function exitHandler (terminationLevel) {
    if (showMessageOnExit && !exitMessageShown) {
        exitMessageShown = true;

        log.write('Stopping TestCafe...');

        process.on('exit', () => log.hideSpinner(true));
    }

    if (exiting || terminationLevel < 2)
        return;

    exiting = true;

    exit(0);
}

function exit (code) {
    log.hideSpinner(true);

    // NOTE: give a process time to flush the output.
    // It's necessary in some environments.
    setTimeout(() => process.exit(code), 0);
}

function error (err) {
    log.hideSpinner();

    let message = null;

    if (err instanceof GeneralError)
        message = err.message;

    else if (err instanceof APIError)
        message = err.coloredStack;

    else
        message = err.stack;

    log.write(chalk.red('ERROR ') + message + '\n');
    log.write(chalk.gray('Type "testcafe -h" for help.'));

    exit(1);
}

async function getBrowserInfo (browser) {
    try {
        return {
            error: null,
            info:  await browserProviderPool.getBrowserInfo(browser)
        };
    }
    catch (err) {
        return {
            error: err,
            info:  null
        };
    }
}

async function getBrowsersAndSources (testCafe, argParser) {
    const configuration   = testCafe.configuration;
    const browsersOptions = configuration.getOption(OPTION_NAMES.browsers);

    if (!browsersOptions)
        return [argParser.browsers, argParser.src];

    const browserInfo              = await Promise.all(argParser.browsers.map(browser => getBrowserInfo(browser)));
    const [parsedInfo, failedInfo] = partition(browserInfo, info => !info.error);

    if (!parsedInfo.length)
        return [[], [argParser.browsers, ...argParser.src]];

    throw new CompositeError(failedInfo.map(info => info.error));
}

async function runTests (argParser) {
    const opts              = argParser.opts;
    const port1             = opts.ports && opts.ports[0];
    const port2             = opts.ports && opts.ports[1];
    const proxy             = opts.proxy;
    const proxyBypass       = opts.proxyBypass;

    log.showSpinner();

    const testCafe = await createTestCafe(opts.hostname, port1, port2, opts.ssl, opts.dev);

    const [automatedBrowsers, sources] = await getBrowsersAndSources(testCafe, argParser);
    const remoteBrowsers               = await remotesWizard(testCafe, argParser.remoteCount, opts.qrCode);
    const browsers                     = automatedBrowsers.concat(remoteBrowsers);

    const runner = opts.live ? testCafe.createLiveModeRunner() : testCafe.createRunner();

    let failed = 0;


    runner.isCli = true;

    runner
        .useProxy(proxy, proxyBypass)
        .src(sources)
        .browsers(browsers)
        .reporter(argParser.opts.reporter)
        .concurrency(argParser.opts.concurrency)
        .filter(argParser.filter)
        .video(opts.video, opts.videoOptions, opts.videoEncodingOptions)
        .screenshots(opts.screenshots, opts.screenshotsOnFails, opts.screenshotPathPattern)
        .startApp(opts.app, opts.appInitDelay);

    runner.once('done-bootstrapping', () => log.hideSpinner());

    try {
        failed = await runner.run(opts);
    }

    finally {
        showMessageOnExit = false;
        await testCafe.close();
    }

    exit(failed);
}

async function listBrowsers (providerName = 'locally-installed') {
    const provider = await browserProviderPool.getProvider(providerName);

    if (!provider)
        throw new GeneralError(MESSAGE.browserProviderNotFound, providerName);

    if (provider.isMultiBrowser) {
        const browserNames = await provider.getBrowserList();

        await browserProviderPool.dispose();

        if (providerName === 'locally-installed')
            console.log(browserNames.join('\n'));
        else
            console.log(browserNames.map(browserName => `"${providerName}:${browserName}"`).join('\n'));
    }
    else
        console.log(`"${providerName}"`);

    exit(0);
}

(async function cli () {
    const terminationHandler = new TerminationHandler();

    terminationHandler.on(TerminationHandler.TERMINATION_LEVEL_INCREASED_EVENT, exitHandler);

    try {
        const argParser = new CliArgumentParser();

        await argParser.parse(process.argv);

        if (argParser.opts.listBrowsers)
            await listBrowsers(argParser.opts.providerName);
        else
            await runTests(argParser);
    }
    catch (err) {
        showMessageOnExit = false;
        error(err);
    }
})();

