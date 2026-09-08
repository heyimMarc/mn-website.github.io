---
title: "Spock Testing-Framework"
date: 2019-10-20T13:23:10+01:00
description: Spock Testing-Framework
menu:
  sidebar:
    name: Spock Testing-Framework
    identifier: spock
    weight: 10
tags: ["java", "testing", "spock", "junit", "groovy"]
categories: ["testing"]
---
First of all, [Spock](http://spockframework.org) and [JUnit](https://junit.org) are both great test frameworks, and JUnit is usually one of the standard tools I reach for in a project. In my last project a colleague suggested Spock, and we decided to try it out in one of our microservices and roll it out everywhere if we liked it, which we finally did. You can find all examples [here](https://github.com/heyimMarc/playground/tree/master/spock-junit-comparison) on GitHub, of course.

We have looked at the following criteria:
* Code documentation
* Parameterization
* Output
* Speed

Code Documentation
---

In every piece of code it is good practice to have self-explanatory method names, variable names, class names and objects. The same applies to test methods and test classes.

In Spock the code documents itself by default. There is the @Title declaration for the entire test class, and each test method is divided into given/when/then/(where) blocks, all of which can be supplemented with strings for explanation. We also wrote the names of the test methods in simple, understandable English.

![spock title example](/images/sections/posts/spock2019/spock-title.jpg)

![spock sample test](/images/sections/posts/spock2019/spock_test.jpg)

JUnit in comparison does not enforce documentation. So if you want it, you have to develop a self-explanatory code yourself and at least add some comments.

Parameterization
---

Creating so-called [datatables](http://spockframework.org/spock/docs/1.0/data_driven_testing.html) is also very pleasant with Spock, but let's start from the beginning.

Parameterization is the technique where test data is changed for the same test method, so that the test run executes the same code, but the data is changed.

Suppose we have a method that returns a different value depending on the parameter passed. Parameterization is suitable for such cases.

![spock datatable example](/images/sections/posts/spock2019/spock-datatable.jpg)

Here is the equivalent in JUnit, you can see that in Spock it looks much more tidy.

![junit datatable example](/images/sections/posts/spock2019/junit_datatable.jpg)

Output
---

I don't know about you, but my tests are all red in the beginning, meaning they fail, that's because I'm going the test driven way whenever possible and that's why I put a lot of emphasis on the output of the test framework. With JUnit I often have to turn on the debugger to know exactly what is going on, but take a look.

![junit output example](/images/sections/posts/spock2019/junit_result.jpg)

We see here that JUnit tells us that in the test helloWorldReturnsHelloFailing() an AssertionFailedError is thrown because the value true expected but false was returned. Unfortunately we do not see why this is so.

![spock output example](/images/sections/posts/spock2019/spock_result.jpg)

Spock, on the other hand, is a bit more noisy: we see that "Hello world" was returned, that "world" was passed as a parameter and that "buggy" was expected, and therefore the result is false.
That saves me the debugger in most cases, and with it a lot of time. This noisiness of Spock was the decisive factor that convinced me.

Speed
---

When it comes to speed, Spock loses mercilessly: JUnit runs the example tests in 87 ms, while Spock takes 718 ms: almost ten times as long. I assume the reason is the feature set that Spock provides out of the box, such as mocking, stubbing and spying: things you have to add to JUnit with additional libraries.
