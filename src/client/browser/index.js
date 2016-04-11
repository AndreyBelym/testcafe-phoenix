// TODO: once we'll have client commons load it from there instead of node modules (currently it's leads to two copies of this packages on client)
import Promise from 'pinkie';
import COMMAND from '../../browser-connection/command';


const HEARTBEAT_INTERVAL = 30 * 1000;


//Utils
// NOTE: the window.XMLHttpRequest may have been wrapped by Hammerhead, while we should send a request to
// the original URL. That's why we need the XMLHttpRequest argument to send the request via native methods.
function sendXHR (url, XMLHttpRequest) {
    return new Promise((resolve, reject) => {
        var hammerhead = window['%hammerhead%'];

        var xhr = hammerhead ? hammerhead.get('./sandbox/xhr').createNativeXHR() : new XMLHttpRequest();

        xhr.open('GET', url, true);

        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
                if (xhr.status === 200)
                    resolve(xhr.responseText ? JSON.parse(xhr.responseText) : '');
                else
                    reject('disconnected');
            }
        };

        xhr.send(null);
    });
}

function isCurrentLocation (url) {
    return document.location.href.toLowerCase() === url.toLowerCase();
}


//API
export function startHeartbeat (heartbeatUrl, XMLHttpRequest) {
    sendXHR(heartbeatUrl, XMLHttpRequest);

    window.setInterval(() => sendXHR(heartbeatUrl, XMLHttpRequest), HEARTBEAT_INTERVAL);
}

export function checkStatus (statusUrl, XMLHttpRequest) {
    return sendXHR(statusUrl, XMLHttpRequest)
        .then((res) => {
            if (res.cmd === COMMAND.run || res.cmd === COMMAND.idle && !isCurrentLocation(res.url))
                document.location = res.url;

            return res.cmd;
        });
}

