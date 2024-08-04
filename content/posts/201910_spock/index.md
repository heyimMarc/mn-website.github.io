---
title: "Spock Testing-Framework"
date: 2019-10-20T13:23:10+01:00
description: Spock Testing-Framework
menu:
  sidebar:
    name: Spock Testing-Framework
    identifier: spock
    weight: 10
tags: []
categories: []
---
First of all [Spock](http://spockframework.org) and [JUnit](https://junit.org) are both great test frameworks, usually JUnit is one of my standard tools that I unpack in a project. In my last project, a colleague had thrown Spock into the room and we decided to try it out in one of our microservices and roll it out completely if we liked it, which we finally did. You can find all examples [here](https://github.com/heyimMarc/playground/tree/master/spock-junit-comparison) on Github, of course.

We have looked at the following criteria:
* Code documentation
* Parameterization
* Output
* Speed

Code Documentation
---

In each piece of developed code it is good practice to have self-explanatory methods, variable names and class names, objects, etc. The same applies to test methods/classes.

In Spock the code snippet documents our code by default. We have the @Title declaration for the entire test class. Each test method, is divided into /when/then/{where} blocks and these blocks can all be supplemented with strings for explanation. We have also written the name of the test method in simple and understandable English.

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

Spock on the other hand is a bit more noisy, so we see that "Hello world" was returned, "world" was passed as parameter and "buggy" was expected and therefore the result is false.
So I save myself debugging in most cases and therefore a lot of time. This noisyness of Spock was a decisive factor that convinced me.

Speed
---

When it comes to speed, Spock loses mercilessly, while JUnit runs the example tests in 87ms, Spock needs with 718ms almost ten times as long as JUnit. I the reason for this is the featureset that Spock provides out of the box like mocking, stubbing, spying etc. Things that can be added to Junit with additional libs.
