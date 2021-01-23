const WorkersSentry = require('workers-sentry/worker');
const parser = require('cron-parser');
const { Octokit } = require('@octokit/core');
const data = require('./data.yml');

// Util to send a text response
const textResponse = content => new Response(content, {
    headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Expires': '0',
        'Surrogate-Control': 'no-store',
    },
});

// Util to send a JSON response
const jsonResponse = obj => new Response(JSON.stringify(obj), {
    headers: {
        'Content-Type': 'application/json',
    },
});

// Convert a workflow cron to a KV key
const workflowCronKey = data => `${data.owner}/${data.repo}/${data.ref}/${data.workflow}/${data.cron}`;

// Run each workflow that is due to run
const executeWorkflows = async sentry => {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // Iterate over each workflow and each cron within
    for (const workflow of data.workflows) {
        for (const cron of workflow.cron) {
            // Try to get a last run timestamp
            const last = await WORKFLOW_CRON_LAST_RUNS.get(workflowCronKey({ ...workflow, cron }));

            // Determine if the cron should trigger within a 1 minute bubble of now
            const now = new Date();
            const options = {
                currentDate: last === null ? new Date(now.getTime() - 30 * 1000) : new Date(Number(last)),
                endDate: new Date(now.getTime() + 30 * 1000),
                iterator: false,
            };
            const interval = parser.parseExpression(cron, options);

            // If it should trigger, let's trigger it
            if (interval.hasNext()) {
                await octokit.request(
                    'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
                    {
                        owner: workflow.owner,
                        repo: workflow.repo,
                        workflow_id: workflow.workflow,
                        ref: workflow.ref,
                    },
                )
                    // If successful, store the timestamp now
                    .then(() => WORKFLOW_CRON_LAST_RUNS.put(
                        workflowCronKey({ ...workflow, cron }),
                        Math.max(Date.now(), interval.next().getTime()),
                    ))
                    // If errored, don't store but log error
                    .catch(err => sentry.captureException(err));
            }
        }
    }
}

// Process all requests to the worker
const handleRequest = async ({ request, wait, sentry }) => {
    const url = new URL(request.url);

    // Health check route
    if (url.pathname === '/health') return textResponse('OK');

    // Get jobs route
    if (url.pathname === '/jobs') return jsonResponse(data);

    // Execute triggers route
    if (url.pathname === '/execute') {
        // Trigger each workflow in the background after
        wait(executeWorkflows(sentry).catch(err => sentry.captureException(err)));

        // Return all jobs
        return jsonResponse(data);
    }

    // Not found
    return new Response(null, { status: 404 });
};

// Register the worker listener
addEventListener('fetch', event => {
    // Start Sentry
    const sentry = new WorkersSentry(event, process.env.SENTRY_DSN);

    // Process the event
    try {
        return event.respondWith(handleRequest({ request: event.request, wait: event.waitUntil.bind(event), sentry }));
    } catch (err) {
        // Log & re-throw any errors
        console.error(err);
        sentry.captureException(err);
        throw err;
    }
});

// Also listen for a cron trigger
addEventListener('scheduled', event => {
    // Start Sentry
    const sentry = new WorkersSentry(event, process.env.SENTRY_DSN);

    // Process the event
    try {
        return event.waitUntil(executeWorkflows(sentry));
    } catch (err) {
        // Log & re-throw any errors
        console.error(err);
        sentry.captureException(err);
        throw err;
    }
});
