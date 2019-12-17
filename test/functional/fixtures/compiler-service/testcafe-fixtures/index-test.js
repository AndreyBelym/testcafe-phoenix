fixture `Compiler service`;

test(`Basic test`, async t => {
    await t.expect(String(process.ppid)).eql(process.env.TESTCAFE_PID);
});

test(`Throw an error`, async t => {
    await t.expect(String(process.ppid)).eql(process.env.TESTCAFE_PID);

    await t.click('#not-exists');
});
