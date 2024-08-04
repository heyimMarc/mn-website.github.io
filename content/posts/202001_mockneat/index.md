---
title: "Generating data with Mockneat"
date: 2020-01-03T13:23:10+01:00
description: Generating data with Mockneat
menu:
  sidebar:
    name: Generating data with Mockneat
    identifier: mockneat
    weight: 10
tags: []
categories: []
---


At some point every developer comes to the point where he needs larger amounts of data. One OpenSource library I like to use is Mockneat.

The Mockneat library offers an easy to read API to generate Json, XML, CSV, SQL and whole POJO's. The nice thing about it is that you can generate valid data with little effort.

Just a foretaste of what Mockneat can generate without much effort:

![mockneat dataset](/images/sections/posts/mockneat/mockneat_dataset.jpg)

Should something be missing nevertheless times I soak also gladly on
```java
mock.regex("([LO]){2}\\\d{6}\$")
```
You can use a Regular expression to generate a value that fits into the regex.

There are plenty of code examples, just have a look at [Examples](https://www.mockneat.com/tutorial/) or also visits the project on [Github](https://github.com/nomemory/mockneat) directly.
