# Third-party notices

YAWF is GPL-3.0. It bundles or adapts code under the following licenses.

## Express

`src/api/**` uses [Express](https://expressjs.com/) for HTTP routing.

Copyright (c) 2009-2014 TJ Holowaychuk
Copyright (c) 2013-2014 Roman Shtylman
Copyright (c) 2014-2015 Douglas Christopher Wilson

Licensed under the MIT License.

## whatsapp-web.js (adapted)

`src/bridge/injected.js` adapts the WhatsApp Web internal-Store discovery technique
from [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) (specifically the
approach used in its `src/util/Injected/*.js` scripts for resolving WhatsApp Web's
internal webpack module registry). The transport around that logic is original to
YAWF (an Electron `contextIsolation` bridge via `executeJavaScript` and DOM
`CustomEvent`s, in place of whatsapp-web.js's Puppeteer `page.evaluate`/
`exposeFunction` transport), but the module-discovery approach itself is adapted
from that project.

Copyright (c) whatsapp-web.js contributors.

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at

    http://www.apache.org/licenses/LICENSE-2.0

Changes were made: the discovery logic was adapted from a Puppeteer/CDP transport
to an Electron `contextIsolation`-compatible transport (see `src/bridge/protocol.js`
and `src/bridge/client.js`), and output shaping was rewritten to match YAWF's own
data model (`src/bridge/normalize.js`).
