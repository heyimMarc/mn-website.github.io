---
title: "Gitlab CI Debugging"
date: 2017-08-29T13:23:10+01:00
description: Gitlab CI Debugging
menu:
  sidebar:
    name: Generating data with Mockneat
    identifier: Gitlab CI Debugging
    weight: 10
tags: []
categories: []
---

I would like to show you how to debug a CI process locally using Gitlab CI.
I often see a firework of failed Gitlab CI tests when creating new projects. Even it's very easy to test the CI process locally before pushing it into the repo.
First of all it requires docker to be installed, you can find it [here.](https://www.docker.com/get-started)
You also need a GIT project and the corresponding [.gitlab-ci.yml](https://docs.gitlab.com/ce/ci/quick_start/README.html) which defines your CI process.

GitlabCI Dashboard
--
The dashboard is only a web interface, it does not execute the CI processes, but delegates them to a pool of runners. When the dashboard gets the instruction to start a pipeline, it adds this pipeline to a queue. The queue is then processed by the runners.

Gitlab Runner
--

The runners can be started on any instance. Typically, the runners register themselves with the specified Gitlab instance.
Runners can be enhanced with names and tags, have their instructions returned from the Gitlab Dashboard, and report the result.
GitlabCI runners can also work without a connection to the Gitlab CI instance. In offline mode, functionality is limited, but it is possible to read and execute the local .gitlab-ci.yml file. Offline Runners must be run from the command line.

Installation of a Gitlab Runner
--

In my case I'm doing the installation for Mac OS, but here I link the [official documentation](https://docs.gitlab.com/runner/install/osx.html#installation) which also supports other operating systems.
It is also possible to start the Runner directly from Docker see [here](https://hub.docker.com/r/gitlab/gitlab-runner/).

```bash
$ sudo curl --output /usr/local/bin/gitlab-ci-multi-runner https://gitlab-ci-multi-runner-downloads.s3.amazonaws.com/latest/binaries/gitlab-ci-multi-runner-darwin-amd64
```

```bash
$ sudo chmod +x /usr/local/bin/gitlab-ci-multi-runner
```

Test the installation
--

```bash
$ gitlab-ci-multi-runner
```

should return the following:

![Gitlab-Runner console](/images/sections/posts/gitlabrunner/gitlab-runner_console.jpg)

Start a Job
--

As am example I'll use this .gitlab-ci.yaml

```yaml
image: node:latest

task1:
  script:
    - npm install
    - npm test
```

You can execute task1 with the following commands:

```bash
$ cd path/to/project
$ ls .gitlab-ci.yml
.gitlab-ci.yml
$ gitlab-ci-multi-runner exec docker task1
```

The runner should now run the task. Of course Gitlab cache and artifacts are not working on a local gitlab- runner, but at least the possibility to test a ci file quick localy without annoying team members is quite good.
