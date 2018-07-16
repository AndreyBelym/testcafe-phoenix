import { expect } from 'chai';
import config from '../../../../../config';


const BROWSERS_COUNT = config.currentEnvironment.browsers.length;

fixture `Fixture1`
    .before(ctx => {
        ctx.prop = 'before';
    })
    .after(ctx => {
        var items = ctx.prop.split('|');

        expect(items.filter(item => item === 'before').length).eql(1);
        expect(items.filter(item => item === 'test1').length).eql(BROWSERS_COUNT);
        expect(items.filter(item => item === 'test2').length).eql(BROWSERS_COUNT);
    });

test('Test1', async t => {
    await t.expect(t.fixtureCtx.prop).contains('before');

    t.fixtureCtx.prop += '|test1';
});

test('Test2', async t => {
    await t
        .expect(t.fixtureCtx.prop).contains('before')
        .expect(t.fixtureCtx.prop).contains('test1');

    t.fixtureCtx.prop += '|test2';
});


fixture `Fixture2`;

test('Test1', t => {
    if (!t.fixtureCtx.prop)
        t.fixtureCtx.prop = '';

    t.fixtureCtx.prop += 'test1';
});

test('Test2', async t => {
    await t.expect(t.fixtureCtx.prop).contains('test1');
});
