---
title: "Node.js and NPM behind an enterprise proxy"
date: 2017-10-25T13:23:10+01:00
description: Node.js and NPM behind an enterprise proxy
menu:
  sidebar:
    name: Node.js and NPM behind an enterprise proxy
    identifier: npm
    weight: 10
tags: []
categories: []
---
For those who, like me, sometimes have to access the Internet via a proxy, the use of Nodes Package Manager NPM can be a real struggle. At first I thought that the proxy can be configured as usual in the Linux world via the environment variables HTTP_PROXY and HTTPS_PROXY. Unfortunately I thought wrong...

This is how NPM needs to be configured:

```bash
npm config set proxy http://proxy.de:8080
npm config set https-proxy http://proxy.de:8080
```
