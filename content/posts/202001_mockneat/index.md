---
title: "Generating data with Mockneat"
date: 2020-01-03T13:23:10+01:00
description: Generating data with Mockneat
menu:
  sidebar:
    name: Generating data with Mockneat
    identifier: mockneat
    weight: 10
tags: ["java", "testing", "test-data"]
categories: ["java"]
---


At some point every developer reaches the point where they need larger amounts of data. One open-source library I like to use is Mockneat.

The Mockneat library offers an easy-to-read API to generate JSON, XML, CSV, SQL and whole POJOs. The nice thing about it is that you can generate valid data with little effort.

Just a foretaste of what Mockneat can generate without much effort:

![mockneat dataset](/images/sections/posts/mockneat/mockneat_dataset.jpg)

If something is still missing, I can fall back on a regular expression:
```java
mock.regex("([LO]){2}\\\d{6}\$")
```
You can use a Regular expression to generate a value that fits into the regex.

There are plenty of code examples: have a look at the [tutorial](https://www.mockneat.com/tutorial/) or visit the project on [GitHub](https://github.com/nomemory/mockneat) directly.
