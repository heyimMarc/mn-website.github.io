---
title: "Licecap for better bug tickets"
date: 2019-09-20T13:23:10+01:00
description: Licecap for better bug tickets
menu:
  sidebar:
    name: Licecap for better bug tickets
    identifier: licecap
    weight: 10
tags: ["tooling", "jira", "productivity"]
categories: ["tooling"]
---

How to record screen videos with LICEcap and create better bug tickets.
LICEcap is a tool for recording screen captures, which are then converted into animated GIFs and can easily be posted to a ticket tool such as Jira.

LICEcap is very simple because it has only two buttons. One to start the recording and one to stop it.

A colleague showed me a similar tool in a sprint review today, and I will use LICEcap for bug tickets from now on, because a video is often much more meaningful than text on its own. The nice thing about animated GIFs is that you don't need an embedded video player, they work natively. In Jira it is enough to attach the GIF to the ticket, and it plays directly when the ticket is opened.

LICEcap can be found [here](https://www.cockos.com/licecap/),
or if you are a Mac user, you can install it via Homebrew:
```bash
$ brew install --cask licecap
```
