# AI for Beginners — 12 Weeks, 24 Lessons (Microsoft)

> Source: [microsoft/AI-For-Beginners](https://github.com/microsoft/AI-For-Beginners) — auto-imported via repo-fetcher pipeline.

## Course Setup

### For Educators

Would you like to use this curriculum in your classroom? Please feel free!

In fact, you can use it within GitHub itself by using GitHub Classroom.

To do that, fork this repo. You are going to need to create a repo for each lesson, so you're going to need to extract each folder into a separate repo. That way, [GitHub Classroom](https://classroom.github.com/classrooms) can pick up each lesson separately. 

These [full instructions](https://github.blog/2020-03-18-set-up-your-digital-classroom-with-github-classroom/) will give you an idea how to set up your classroom.

#### Using the repo as is

If you would like to use this repo as it currently stands, without using GitHub Classroom, that can be done as well. You would need to communicate with your students which lesson to work through together.

In an online format (Zoom, Teams, or other) you might form breakout rooms for the quizzes, and mentor students to help them get ready to learn. Then invite students to for the quizzes and submit their answers as 'issues' at a certain time. You might do the same with assignments, if you want students to work collaboratively out in the open.

If you prefer a more private format, ask your students to fork the curriculum, lesson by lesson, to their own GitHub repos as private repos, and give you access. Then they can complete quizzes and assignments privately and submit them to you via issues on your classroom repo.

There are many ways to make this work in an online classroom format. Please let us know what works best for you!

#### Please give us your thoughts

We want to make this curriculum work for you and your students. Please give us feedback in the discussion boards!

### Using Visual Studio Code with Python Extension

This curriculum is best used when opening it in [Visual Studio Code](http://code.visualstudio.com/?WT.mc_id=academic-77998-cacaste) with [Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python&WT.mc_id=academic-77998-cacaste).

> **Note**: Once you clone and open the directory in VS Code, it will automatically suggest you to install Python extensions. You would also have to install miniconda as described above.

> **Note**: If VS Code suggests to you to re-open the repository in a container, you should decline this to use the local Python installation.

### Using Jupyter in the Browser

You can also use a Jupyter environment from the browser on your own computer. Both classical Jupyter and JupyterHub provide a convenient development environment with auto-completion, code highlighting, etc.

To start Jupyter locally, go to the directory of the course, and execute:

```bash
jupyter notebook
```
or
```bash
jupyterhub
```
You then can navigate to any of the `.ipynb` files, open them and start working.

### Running in container

One alternative to Python installation would be to run the code in a container. Since our repository supplies a special `.devcontainer` folder that instructs how to build a container for this repo, VS Code offers the opportunity to re-open the code in a container. This will require Docker installation, and also would be more complex, so we recommend this to more experienced users.

### Getting Started with this Curricula

#### Are you a student?

Get started with the following resources:

* [Student Hub page](https://docs.microsoft.com/learn/student-hub?WT.mc_id=academic-77998-cacaste) On this page, you will find beginner resources, Student packs, and even ways to get a free cert voucher. This is one page you want to bookmark and check from time to time as we switch out content at least monthly.
* [Microsoft Student Learn ambassadors](https://studentambassadors.microsoft.com?WT.mc_id=academic-77998-cacaste) Join a global community of student ambassadors, this could be your way into Microsoft.

**Students**, there are a couple of ways to use the curriculum. First of all, you can just read the text and look through the code directly on GitHub. If you want to run the code in any of the notebooks - [read our instructions](./how-to-run.md), and find more advice on how to do it [in this blog post](https://soshnikov.com/education/how-to-execute-notebooks-from-github/).

> **Note**: [Instructions on how to run the code in this curriculum](./how-to-run.md)

#### Self Study

However, if you would like to take the course as a self-study project, we suggest that you fork the entire repo to your own GitHub account and complete the exercises on your own or with a group:

* Start with a pre-lecture quiz.
* Read the intro text for the lecture.
* If the lecture has additional notebooks, go through them, reading and executing the code. If both TensorFlow and PyTorch notebooks are provided, you can focus on one of them - choose your favorite framework.
* Notebooks often contain some of the challenges that require you to tweak the code a little bit to experiment.
* Take the post-lecture quiz.
* If there is a lab attached to the module - complete the assignment.
* Visit the [Discussion board](https://github.com/microsoft/AI-For-Beginners/discussions) to "learn out loud".

> For further study, we recommend following these [Microsoft Learn](https://docs.microsoft.com/en-us/users/dmitrysoshnikov-9132/collections/31zgizg2p418yo/?WT.mc_id=academic-77998-cacaste) modules and learning paths.

**Teachers**, we have [included some suggestions](./for-teachers.md) on how to use this curriculum.

---

#### Pedagogy

We have chosen two pedagogical tenets while building this curriculum: ensuring that it is hands-on **project-based** and that it includes **frequent quizzes**.

By ensuring that the content aligns with projects, the process is made more engaging for students and retention of concepts will be augmented. In addition, a low-stakes quiz before a class sets the intention of the student towards learning a topic, while a second quiz after class ensures further retention. This curriculum was designed to be flexible and fun and can be taken in whole or in part. The projects start small and become increasingly complex by the end of the 12-week cycle.

> **A note about quizzes**: All quizzes are contained [in this app](https://red-field-0a6ddfd03.1.azurestaticapps.net/), for 50 total quizzes of three questions each. They are linked from within the lessons but the quiz app can be run locally; follow the instructions in the `etc/quiz-app` folder.

#### Offline access

You can run this documentation offline by using [Docsify](https://docsify.js.org/#/). Fork this repo, [install Docsify](https://docsify.js.org/#/quickstart) on your local machine, and then in the root folder of this repo, type `docsify serve`. The website will be served on port 3000 on your localhost: `localhost:3000`. A pdf of the curriculum is available [at this link](/etc/pdf/readme.pdf).

## Intro

### The Top-Down Approach

In a **top-down approach**, we try to model our reasoning.  Because we can follow our thoughts when we reason, we can try to formalize this process and program it inside the computer. This is called **symbolic reasoning**.

People tend to have some rules in their head that guide their decision making processes. For example, when a doctor is diagnosing a patient, he or she may realize that a person has a fever, and thus there might be some inflammation going on inside the body. By applying a large set of rules to a specific problem a doctor may be able to come up with the final diagnosis.

This approach relies heavily on **knowledge representation** and **reasoning**. Extracting knowledge from a human expert might be the most difficult part, because a doctor in many cases would not know exactly why he or she is coming up with a particular diagnosis. Sometimes the solution just comes up in his or her head without explicit thinking. Some tasks, such as determining the age of a person from a photograph, cannot be at all reduced to manipulating knowledge.

### Bottom-Up Approach

Alternately, we can try to model the simplest elements inside our brain – a neuron. We can construct a so-called **artificial neural network** inside a computer, and then try to teach it to solve problems by giving it examples. This process is similar to how a newborn child learns about his or her surroundings by making observations.

✅ Do a little research on how babies learn. What are the basic elements of a baby's brain?

> | What about ML?         |      |
> |--------------|-----------|
> | Part of Artificial Intelligence that is based on computer learning to solve a problem based on some data is called **Machine Learning**. We will not consider classical machine learning in this course - we refer you to a separate [Machine Learning for Beginners](http://aka.ms/ml-beginners) curriculum. |   ![ML for Beginners](images/ml-for-beginners.png)    |

## Symbolic

### Forward vs. Backward Inference

The process described above is called **forward inference**. It starts with some initial data about the problem available in the working memory, and then executes the following reasoning loop:

1. If the target attribute is present in the working memory - stop and give the result
2. Look for all the rules whose condition is currently satisfied - obtain **conflict set** of rules.
3. Perform **conflict resolution** - select one rule that will be executed on this step. There could be different conflict resolution strategies:
   - Select the first applicable rule in the knowledge base
   - Select a random rule
   - Select a *more specific* rule, i.e. the one meeting the most conditions in the "left-hand-side" (LHS)
4. Apply selected rule and insert new piece of knowledge into the problem state
5. Repeat from step 1.

However, in some cases we might want to start with an empty knowledge about the problem, and ask questions that will help us arrive to the conclusion. For example, when doing medical diagnosis, we usually do not perform all medical analyses in advance before starting diagnosing the patient. We rather want to perform analyses when a decision needs to be made.

This process can be modeled using **backward inference**. It is driven by the **goal** - the attribute value that we are looking to find:

1. Select all rules that can give us the value of a goal (i.e. with the goal on the RHS ("right-hand-side")) - a conflict set
1. If there are no rules for this attribute, or there is a rule saying that we should ask the value from the user - ask for it, otherwise:
1. Use conflict resolution strategy to select one rule that we will use as *hypothesis* - we will try to prove it
1. Recurrently repeat the process for all attributes in the LHS of the rule, trying to prove them as goals
1. If at any point the process fails - use another rule at step 3.

> ✅ In which situations is forward inference more appropriate? How about backward inference?

### Implementing Expert Systems

Expert systems can be implemented using different tools:

* Programming them directly in some high level programming language. This is not the best idea, because the main advantage of a knowledge-based system is that knowledge is separated from inference, and potentially a problem domain expert should be able to write rules without understanding the details of the inference process
* Using **expert systems shell**, i.e. a system specifically designed to be populated by knowledge using some knowledge representation language.

## Neural Networks

### Introduction to Neural Networks: Perceptron

> **📖 章节概述**
>
> # Introduction to Neural Networks
> 
> ![Summary of Intro Neural Networks content in a doodle](../sketchnotes/ai-neuralnetworks.png)
> 
> As we discussed in the introduction, one of the ways to achieve intelligence is to train a **computer model** or an **artificial brain**. Since the middle of 20th century, researchers tried different mathematical models, until in recent years this direction proved to be hugely successful. Such mathematical models of the brain are called **neural networks**.
> 
> > Sometimes neural networks are called *Artificial Neural Networks*, ANNs, in order to indicate that we are talking about models, not real networks of neurons.
> 
> ## Machine Learning
> 
> Neural Networks are a part of a larger discipline called **Machine Learning**, whose goal is to use data to train computer models that are able to solve problems. Machine Learning constitutes a large part of Artificial Intelligence, however, we do not cover classical ML in this curricula.
> 
> > Visit our separate **[Machine Learning for Beginners](http://github.com/microsoft/ml-for-beginners)** curriculum to learn more about classic Machine Learning.
> 
> In Machine Learning, we assume that we have some dataset of examples **X**, and corresponding output values **Y**. Examples are often N-dimensional vectors that consist of **features**, and outputs are called **labels**.
> 
> We will consider the two most common machine learning problems:
> 
> * **Classification**, where we need to classify an input object into two or more classes.
> * **Regression**, where we need to predict a numerical number for each of the input samples.
> 
> > When representing inputs and outputs as tensors, the input dataset is a matrix of size M&times;N, where M is number of samples and N is the number of features. Output labels Y is the vector of size M.
> 
> In this curriculum, we will only focus on neural network models.
> 
> ## A Model of a Neuron
> 
> From biology, we know that our brain consists of neural cells (neurons), each of them having multiple "inputs" (dendrites) and a single "output" (axon). Both dendrites and axons can conduct electrical signals, and the connections between them — known as synapses — can exhibit varying degrees of conductivity, which are regulated by neurotransmitters.
> 
> ![Model of a Neuron](images/synapse-wikipedia.jpg) | ![Model of a Neuron](images/artneuron.png)
> ----|----
> Real Neuron *([Image](https://en.wikipedia.org/wiki/Synapse#/media/File:SynapseSchematic_lines.svg) from Wikipedia)* | Artificial Neuron *(Image by Author)*
> 
> Thus, the simplest mathematical model of a neuron contains several inputs X<sub>1</sub>, ..., X<sub>N</sub> and an output Y, and a series of weights W<sub>1</sub>, ..., W<sub>N</sub>. An output is calculated as:
> 
> <img src="images/netout.png" alt="Y = f\left(\sum_{i=1}^N X_iW_i\right)" width="131" height="53" align="center"/>
> 
> where f is some non-linear **activation function**.
> 
> > Early models of neuron were described in the classical paper [A logical calculus of the ideas immanent in nervous activity](https://www.cs.cmu.edu/~./epxing/Class/10715/reading/McCulloch.and.Pitts.pdf) by Warren McCullock and Walter Pitts in 1943. Donald Hebb in his book "[The Organization of Behavior: A Neuropsychological Theory](https://books.google.com/books?id=VNetYrB8EBoC)" proposed the way those networks can be trained.
> 
> ## In this Section
> 
> In this section we will learn about:
> * [Perceptron](03-Perceptron/README.md), one of the earliest neural network models for two-class classification
> * [Multi-layered networks](04-OwnFramework/README.md) with a paired notebook [how to build our own framework](04-OwnFramework/OwnFramework.ipynb)
> * [Neural Network Frameworks](05-Frameworks/README.md), with these notebooks: [PyTorch](05-Frameworks/IntroPyTorch.ipynb) and [Keras/Tensorflow](05-Frameworks/IntroKerasTF.ipynb)
> * [Overfitting](05-Frameworks#overfitting)
> 

---

One of the first attempts to implement something similar to a modern neural network was done by Frank Rosenblatt from Cornell Aeronautical Laboratory in 1957. It was a hardware implementation called "Mark-1", designed to recognize primitive geometric figures, such as triangles, squares and circles.

|      |      |
|--------------|-----------|
|<img src='images/Rosenblatt-wikipedia.jpg' alt='Frank Rosenblatt'/> | <img src='images/Mark_I_perceptron_wikipedia.jpg' alt='The Mark 1 Perceptron' />|

> Images [from Wikipedia](https://en.wikipedia.org/wiki/Perceptron)

An input image was represented by 20x20 photocell array, so the neural network had 400 inputs and one binary output. A simple network contained one neuron, also called a **threshold logic unit**. Neural network weights acted like potentiometers that required manual adjustment during the training phase.

> ✅ A potentiometer is a device that allows the user to adjust the resistance of a circuit.

> The New York Times wrote about perceptron at that time: *the embryo of an electronic computer that [the Navy] expects will be able to walk, talk, see, write, reproduce itself and be conscious of its existence.*

#### Perceptron Model

Suppose we have N features in our model, in which case the input vector would be a vector of size N. A perceptron is a **binary classification** model, i.e. it can distinguish between two classes of input data. We will assume that for each input vector x the output of our perceptron would be either +1 or -1, depending on the class. The output will be computed using the formula:

y(x) = f(w<sup>T</sup>x)

where f is a step activation function

<!-- img src="http://www.sciweavers.org/tex2img.php?eq=f%28x%29%20%3D%20%5Cbegin%7Bcases%7D%0A%20%20%20%20%20%20%20%20%20%2B1%20%26%20x%20%5Cgeq%200%20%5C%5C%0A%20%20%20%20%20%20%20%20%20-1%20%26%20x%20%3C%200%0A%20%20%20%20%20%20%20%5Cend%7Bcases%7D%20%5C%5C%0A&bc=White&fc=Black&im=jpg&fs=12&ff=arev&edit=0" align="center" border="0" alt="f(x) = \begin{cases} +1 & x \geq 0 \\ -1 & x < 0 \end{cases} \\" width="154" height="50" / -->
<img src="images/activation-func.png"/>

#### Training the Perceptron

To train a perceptron we need to find a weights vector w that classifies most of the values correctly, i.e. results in the smallest **error**. This error E is defined by **perceptron criterion** in the following manner:

E(w) = -&sum;w<sup>T</sup>x<sub>i</sub>t<sub>i</sub>

where:

* the sum is taken on those training data points i that result in the wrong classification
* x<sub>i</sub> is the input data, and t<sub>i</sub> is either -1 or +1 for negative and positive examples accordingly.

This criteria is considered as a function of weights w, and we need to minimize it. Often, a method called **gradient descent** is used, in which we start with some initial weights w<sup>(0)</sup>, and then at each step update the weights according to the formula:

w<sup>(t+1)</sup> = w<sup>(t)</sup> - &eta;&nabla;E(w)

Here &eta; is the so-called **learning rate**, and &nabla;E(w) denotes the **gradient** of E. After we calculate the gradient, we end up with

w<sup>(t+1)</sup> = w<sup>(t)</sup> + &sum;&eta;x<sub>i</sub>t<sub>i</sub>

The algorithm in Python looks like this:

```python
def train(positive_examples, negative_examples, num_iterations = 100, eta = 1):

    weights = [0,0,0] # Initialize weights (almost randomly :)
        
    for i in range(num_iterations):
        pos = random.choice(positive_examples)
        neg = random.choice(negative_examples)

        z = np.dot(pos, weights) # compute perceptron output
        if z < 0: # positive example classified as negative
            weights = weights + eta*weights.shape

        z  = np.dot(neg, weights)
        if z >= 0: # negative example classified as positive
            weights = weights - eta*weights.shape

    return weights
```

#### Conclusion

In this lesson, you learned about a perceptron, which is a binary classification model, and how to train it by using a weights vector.

#### 🚀 Challenge

If you'd like to try to build your own perceptron, try [this lab on Microsoft Learn](https://docs.microsoft.com/en-us/azure/machine-learning/component-reference/two-class-averaged-perceptron?WT.mc_id=academic-77998-cacaste) which uses the [Azure ML designer](https://docs.microsoft.com/en-us/azure/machine-learning/concept-designer?WT.mc_id=academic-77998-cacaste).

#### Review & Self Study

To see how we can use perceptron to solve a toy problem as well as real-life problems, and to continue learning - go to [Perceptron](Perceptron.ipynb) notebook.

Here's an interesting [article about perceptrons](https://towardsdatascience.com/what-is-a-perceptron-basics-of-neural-networks-c4cfea20c590
) as well.

#### Task

Solve the MNIST handwritten digit classification problem using 1-, 2- and 3-layered perceptron. Use the neural network framework we have developed in the lesson.

#### Stating Notebook

Start the lab by opening [MyFW_MNIST.ipynb](MyFW_MNIST.ipynb)

#### Questions

As a result of this lab, try to answer the following questions:

- Does the inter-layer activation function affect network performance?
- Do we need 2- or 3-layered network for this task?
- Did you experience any problems training the network? Especially as the number of layers increased.
- How do weights of the network behave during training? You may plot max abs value of weights vs. epoch to understand the relation.

---

**📓 Notebook 代码**（来自 `lessons/3-NeuralNetworks/04-OwnFramework/OwnFramework.ipynb`）:

#### Multi-Layered Perceptrons
#### Building our own Neural Framework

> This notebook is a part of [AI for Beginners Curricula](http://github.com/microsoft/ai-for-beginners). Visit the repository for complete set of learning materials.

In this notebook, we will gradually build our own neural framework capable of solving multi-class classification tasks as well as regression with multi-layered preceptrons.

First, let's import some required libraries.

```python
%matplotlib nbagg
import matplotlib.pyplot as plt 
from matplotlib import gridspec
from sklearn.datasets import make_classification
import numpy as np
# pick the seed for reproducibility - change it to explore the effects of random variations
np.random.seed(0)
import random
```

#### Sample Dataset

As before, we will start with a simple sample dataset with two parameters.

```python
n = 100
X, Y = make_classification(n_samples = n, n_features=2,
                           n_redundant=0, n_informative=2, flip_y=0.2)
X = X.astype(np.float32)
Y = Y.astype(np.int32)

# Split into train and test dataset
train_x, test_x = np.split(X, [n*8//10])
train_labels, test_labels = np.split(Y, [n*8//10])
```

```python
def plot_dataset(suptitle, features, labels):
    # prepare the plot
    fig, ax = plt.subplots(1, 1)
    #pylab.subplots_adjust(bottom=0.2, wspace=0.4)
    fig.suptitle(suptitle, fontsize = 16)
    ax.set_xlabel('$x_i[0]$ -- (feature 1)')
    ax.set_ylabel('$x_i[1]$ -- (feature 2)')

    colors = ['r' if l else 'b' for l in labels]
    ax.scatter(features[:, 0], features[:, 1], marker='o', c=colors, s=100, alpha = 0.5)
    fig.show()
```

```python
plot_dataset('Scatterplot of the training data', train_x, train_labels)
plt.show()
```

```python
print(train_x[:5])
print(train_labels[:5])
```

#### Machine Learning Problem

Suppose we have input dataset $\langle X,Y\rangle$, where $X$ is a set of features, and $Y$ - corresponding labels. For regression problem, $y_i\in\mathbb{R}$, and for classification it is represented by a class number $y_i\in\{0,\dots,n\}$. 

Any machine learning model can be represented by function $f_\theta(x)$, where $\theta$ is a set of **parameters**. Our goal is to find such parameters $\theta$ that our model fits the dataset in the best way. The criteria is defined by **loss function** $\mathcal{L}$, and we need to find optimal value

$$
\theta = \mathrm{argmin}_\theta \mathcal{L}(f_\theta(X),Y)
$$

Loss function depends on the problem being solved.

##### Loss functions for regression

For regression, we often use **abosolute error** $\mathcal{L}_{abs}(\theta) = \sum_{i=1}^n |y_i - f_{\theta}(x_i)|$, or **mean squared error**: $\mathcal{L}_{sq}(\theta) = \sum_{i=1}^n (y_i - f_{\theta}(x_i))^2$

```python
# helper function for plotting various loss functions
def plot_loss_functions(suptitle, functions, ylabels, xlabel):
    fig, ax = plt.subplots(1,len(functions), figsize=(9, 3))
    plt.subplots_adjust(bottom=0.2, wspace=0.4)
    fig.suptitle(suptitle)
    for i, fun in enumerate(functions):
        ax[i].set_xlabel(xlabel)
        if len(ylabels) > i:
            ax[i].set_ylabel(ylabels[i])
        ax[i].plot(x, fun)
    plt.show()
```

```python
x = np.linspace(-2, 2, 101)
plot_loss_functions(
    suptitle = 'Common loss functions for regression',
    functions = [np.abs(x), np.power(x, 2)],
    ylabels   = ['$\mathcal{L}_{abs}}$ (absolute loss)',
                 '$\mathcal{L}_{sq}$ (squared loss)'],
    xlabel    = '$y - f(x_i)$')
```

##### Loss functions for classification

Let's consider binary classification for a moment. In this case we have two classes, numbered 0 and 1. The output of the network $f_\theta(x_i)\in [0,1]$ essentially defines the probability of choosing the class 1.

**0-1 loss**

0-1 loss is the same as calculating accuracy of the model - we compute the number of correct classifications:

$$\mathcal{L}_{0-1} = \sum_{i=1}^n l_i \quad  l_i = \begin{cases}
         0 & (f(x_i)<0.5 \land y_i=0) \lor (f(x_i)<0.5 \land y_i=1) \\
         1 & \mathrm{ otherwise}
       \end{cases} \\
$$

However, accuracy itself does not show how far are we from the right classification. It could be that we missed the correct class just by a little bit, and that is in a way "better" (in a sense that we need to correct weights much less) than missing significantly. Thus, more often logistic loss is used, which takes this into account.

**Logistic Loss**

$$\mathcal{L}_{log} = \sum_{i=1}^n -y\log(f_{\theta}(x_i)) - (1-y)\log(1-f_\theta(x_i))$$

```python
x = np.linspace(0,1,100)
def zero_one(d):
    if d < 0.5:
        return 0
    return 1
zero_one_v = np.vectorize(zero_one)

def logistic_loss(fx):
    # assumes y == 1
    return -np.log(fx)
```

```python
plot_loss_functions(suptitle = 'Common loss functions for classification (class=1)',
                   functions = [zero_one_v(x), logistic_loss(x)],
                   ylabels    = ['$\mathcal{L}_{0-1}}$ (0-1 loss)',
                                 '$\mathcal{L}_{log}$ (logistic loss)'],
                   xlabel     = '$p$')

```

To understand logistic loss, consider two cases of the expected output:
* If we expect output to be 1 ($y=1$), then the loss is $-log f_\theta(x_i)$. The loss is 0 is the network predicts 1 with probability 1, and grows larger when probability of 1 gets smaller.
* If we expect output to be 0 ($y=0$), the loss is $-log(1-f_\theta(x_i))$. Here, $1-f_\theta(x_i)$ is the probability of 0 which is predicted by the network, and the meaning of log-loss is the same as described in the previous case

#### Neural Network Architecture

We have generated a dataset for binary classification problem. However, let's consider it as multi-class classification right from the start, so that we can then easily switch our code to multi-class classification. In this case, our one-layer perceptron will have the following architecture:

<img src="images/NeuroArch.png" width="50%"/>

Two outputs of the network correspond to two classes, and the class with highest value among two outputs corresponds to the right solution.

The model is defined as
$$
f_\theta(x) = W\times x + b
$$
where $$\theta = \langle W,b\rangle$$ are parameters.

We will define this linear layer as a Python class with a `forward` function that performs the calculation. It receives input value $x$, and produces the output of the layer. Parameters `W` and `b` are stored within the layer class, and are initialized upon creation with random values and zeroes respectively.

```python
class Linear:
    def __init__(self,nin,nout):
        self.W = np.random.normal(0, 1.0/np.sqrt(nin), (nout, nin))
        self.b = np.zeros((1,nout))
        
    def forward(self, x):
        return np.dot(x, self.W.T) + self.b
    
net = Linear(2,2)
net.forward(train_x[0:5])
```

In many cases, it is more efficient to operate not on the one input value, but on the vector of input values. Because we use Numpy operations, we can pass a vector of input values to our network, and it will give us the vector of output values.

#### Softmax: Turning Outputs into Probabilities

As you can see, our outputs are not probabilities - they can take any values. In order to convert them into probabilities, we need to normalize the values across all classes. This is done using **softmax** function: $$\sigma(\mathbf{z}_c) = \frac{e^{z_c}}{\sum_{j} e^{z_j}}, \quad\mathrm{for}\quad c\in 1 .. |C|$$

<img src="https://raw.githubusercontent.com/shwars/NeuroWorkshop/master/images/NeuroArch-softmax.PNG" width="50%">

> Output of the network $\sigma(\mathbf{z})$ can be interpreted as probability distribution on the set of classes $C$: $q = \sigma(\mathbf{z}_c) = \hat{p}(c | x)$

We will define the `Softmax` layer in the same manner, as a class with `forward` function: 

```python
class Softmax:
    def forward(self,z):
        zmax = z.max(axis=1,keepdims=True)
        expz = np.exp(z-zmax)
        Z = expz.sum(axis=1,keepdims=True)
        return expz / Z

softmax = Softmax()
softmax.forward(net.forward(train_x[0:10]))
```

You can see that we are now getting probabilities as outputs, i.e. the sum of each output vector is exactly 1. 

In case we have more than 2 classes, softmax will normalize probabilities across all of them. Here is a diagram of network architecture that does MNIST digit classification:

![MNIST Classifier](images/Cross-Entropy-Loss.PNG)

#### Cross-Entropy Loss

A loss function in classification is typically a logistic function, which can be generalized as **cross-entropy loss**. Cross-entropy loss is a function that can calculate similarity between two arbitrary probability distributions. You can find more detailed discussion about it [on Wikipedia](https://en.wikipedia.org/wiki/Cross_entropy).

In our case, first distribution is the probabilistic output of our network, and the second one is so-called **one-hot** distribution, which specifies that a given class $c$ has corresponding probability 1 (all the rest being 0). In such a case cross-entropy loss can be calculated as $-\log p_c$, where $c$ is the expected class, and $p_c$ is the corresponding probability of this class given by our neural network.

> If the network return probability 1 for the expected class, cross-entropy loss would be 0. The closer the probability of the actual class is to 0, the higher is cross-entropy loss (and it can go up to infinity!).

```python
def plot_cross_ent():
    p = np.linspace(0.01, 0.99, 101) # estimated probability p(y|x)
    cross_ent_v = np.vectorize(cross_ent)
    f3, ax = plt.subplots(1,1, figsize=(8, 3))
    l1, = plt.plot(p, cross_ent_v(p, 1), 'r--')
    l2, = plt.plot(p, cross_ent_v(p, 0), 'r-')
    plt.legend([l1, l2], ['$y = 1$', '$y = 0$'], loc = 'upper center', ncol = 2)
    plt.xlabel('$\hat{p}(y|x)$', size=18)
    plt.ylabel('$\mathcal{L}_{CE}$', size=18)
    plt.show()
```

```python
def cross_ent(prediction, ground_truth):
    t = 1 if ground_truth > 0.5 else 0
    return -t * np.log(prediction) - (1 - t) * np.log(1 - prediction)
plot_cross_ent()
```

Cross-entropy loss will be defined again as a separate layer, but `forward` function will have two input values: output of the previous layers of the network `p`, and the expected class `y`:

```python
class CrossEntropyLoss:
    def forward(self,p,y):
        self.p = p
        self.y = y
        p_of_y = p[np.arange(len(y)), y]
        log_prob = np.log(p_of_y)
        return -log_prob.mean() # average over all input samples

cross_ent_loss = CrossEntropyLoss()
p = softmax.forward(net.forward(train_x[0:10]))
cross_ent_loss.forward(p,train_labels[0:10])
```

> **IMPORTANT**: Loss function returns a number that shows how good (or bad) our network performs. It should return us one number for the whole dataset, or for the part of the dataset (minibatch). Thus after calculating cross-entropy loss for each individual component of the input vector, we need to average (or add) all components together - which is done by the call to `.mean()`.

#### Computational Graph

<img src="images/ComputeGraph.png" width="600px"/>

Up to this moment, we have defined different classes for different layers of the network. Composition of those layers can be represented as **computational graph**. Now we can compute the loss for a given training dataset (or part of it) in the following manner:

```python
z = net.forward(train_x[0:10])
p = softmax.forward(z)
loss = cross_ent_loss.forward(p,train_labels[0:10])
print(loss)
```

#### Loss Minimization Problem and Network Training

Once we have defined out network as $f_\theta$, and given the loss function $\mathcal{L}(Y,f_\theta(X))$, we can consider $\mathcal{L}$ as a function of $\theta$ under our fixed training dataset: $\mathcal{L}(\theta) = \mathcal{L}(Y,f_\theta(X))$

In this case, the network training would be a minimization problem of $\mathcal{L}$ under argument $\theta$:
$$
\theta = \mathrm{argmin}_{\theta} \mathcal{L}(Y,f_\theta(X))
$$

There is a well-known method of function optimization called **gradient descent**. The idea is that we can compute a derivative (in multi-dimensional case call **gradient**) of loss function with respect to parameters, and vary parameters in such a way that the error would decrease.

Gradient descent works as follows:
 * Initialize parameters by some random values $w^{(0)}$, $b^{(0)}$
 * Repeat the following step many times:

 $$\begin{align}
 W^{(i+1)}&=W^{(i)}-\eta\frac{\partial\mathcal{L}}{\partial W}\\
 b^{(i+1)}&=b^{(i)}-\eta\frac{\partial\mathcal{L}}{\partial b}
 \end{align}
 $$

During training, the optimization steps are supposed to be calculated considering the whole dataset (remember that loss is calculated as a sum/average through all training samples). However, in real life we take small portions of the dataset called **minibatches**, and calculate gradients based on a subset of data. Because subset is taken randomly each time, such method is called **stochastic gradient descent** (SGD).
 

#### Backward Propagation

<img src="images/ComputeGraph.png" width="300px" align="left"/>

$$\def\L{\mathcal{L}}\def\zz#1#2{\frac{\partial#1}{\partial#2}}
\begin{align}
\zz{\L}{W} =& \zz{\L}{p}\zz{p}{z}\zz{z}{W}\cr
\zz{\L}{b} =& \zz{\L}{p}\zz{p}{z}\zz{z}{b}
\end{align}
$$

To compute $\partial\mathcal{L}/\partial W$ we can use the **chaining rule** for computing derivatives of a composite function, as you can see in the formulae above. It corresponds to the following idea:

* Suppose under given input we have obtanes loss $\Delta\mathcal{L}$
* To minimize it, we would have to adjust softmax output $p$ by value $\Delta p = (\partial\mathcal{L}/\partial p)\Delta\mathcal{L}$  
* This corresponds to the changes to node $z$ by $\Delta z = (\partial\mathcal{p}/\partial z)\Delta p$
* To minimize this error, we need to adjust parameters accordingly: $\Delta W = (\partial\mathcal{z}/\partial W)\Delta z$ (and the same for $b$)

<img src="images/ComputeGraphGrad.PNG" width="400px" align="right"/>

This process starts distributing the loss error from the output of the network back to its parameters. Thus the process is called **back propagation**.

One pass of the network training consists of two parts:
* **Forward pass**, when we calculate the value of loss function for a given input minibatch
* **Backward pass**, when we try to minimize this error by distributing it back to the model parameters through the computational graph.

##### Implementation of Back Propagation

* Let's add `backward` function to each of our nodes that will compute the derivative and propagate the error during the backward pass.
* We also need to implement parameter updates according to the procedure described above

We need to compute derivatives for each layer manually, for example for linear layer $z = x\times W+b$:
$$\begin{align}
\frac{\partial z}{\partial W} &= x \\
\frac{\partial z}{\partial b} &= 1 \\
\end{align}$$

If we need to compensate for the error $\Delta z$ at the output of the layer, we need to update the weights accordingly:
$$\begin{align}
\Delta x &= \Delta z \times W \\
\Delta W &= \frac{\partial z}{\partial W} \Delta z = \Delta z \times x \\
\Delta b &= \frac{\partial z}{\partial b} \Delta z = \Delta z \\
\end{align}$$

**IMPORTANT:** Calculations are done not for each training sample independently, but rather for a whole **minibatch**. Required parameter updates $\Delta W$ and $\Delta b$ are computed across the whole minibatch, and the respective vectors have dimensions: $x\in\mathbb{R}^{\mathrm{minibatch}\, \times\, \mathrm{nclass}}$

```python
class Linear:
    def __init__(self,nin,nout):
        self.W = np.random.normal(0, 1.0/np.sqrt(nin), (nout, nin))
        self.b = np.zeros((1,nout))
        self.dW = np.zeros_like(self.W)
        self.db = np.zeros_like(self.b)
        
    def forward(self, x):
        self.x=x
        return np.dot(x, self.W.T) + self.b
    
    def backward(self, dz):
        dx = np.dot(dz, self.W)
        dW = np.dot(dz.T, self.x)
        db = dz.sum(axis=0)
        self.dW = dW
        self.db = db
        return dx
    
    def update(self,lr):
        self.W -= lr*self.dW
        self.b -= lr*self.db
```

In the same manner we can define `backward` function for the rest of our layers:

```python
class Softmax:
    def forward(self,z):
        self.z = z
        zmax = z.max(axis=1,keepdims=True)
        expz = np.exp(z-zmax)
        Z = expz.sum(axis=1,keepdims=True)
        return expz / Z
    def backward(self,dp):
        p = self.forward(self.z)
        pdp = p * dp
        return pdp - p * pdp.sum(axis=1, keepdims=True)
    
class CrossEntropyLoss:
    def forward(self,p,y):
        self.p = p
        self.y = y
        p_of_y = p[np.arange(len(y)), y]
        log_prob = np.log(p_of_y)
        return -log_prob.mean()
    def backward(self,loss):
        dlog_softmax = np.zeros_like(self.p)
        dlog_softmax[np.arange(len(self.y)), self.y] -= 1.0/len(self.y)
        return dlog_softmax / self.p
```

#### Training the Model

Now we are ready to write the **training loop**, which will go through our dataset, and perform the optimization minibatch by minibatch.One complete pass through the dataset is often called **an epoch**:

```python
lin = Linear(2,2)
softmax = Softmax()
cross_ent_loss = CrossEntropyLoss()

learning_rate = 0.1

pred = np.argmax(lin.forward(train_x),axis=1)
acc = (pred==train_labels).mean()
print("Initial accuracy: ",acc)

batch_size=4
for i in range(0,len(train_x),batch_size):
    xb = train_x[i:i+batch_size]
    yb = train_labels[i:i+batch_size]
    
    # forward pass
    z = lin.forward(xb)
    p = softmax.forward(z)
    loss = cross_ent_loss.forward(p,yb)
    
    # backward pass
    dp = cross_ent_loss.backward(loss)
    dz = softmax.backward(dp)
    dx = lin.backward(dz)
    lin.update(learning_rate)
    
pred = np.argmax(lin.forward(train_x),axis=1)
acc = (pred==train_labels).mean()
print("Final accuracy: ",acc)
    
```

Nice to see how we can increase accuracy of the model from about 50% to around 80% in one epoch.

#### Network Class

Since in many cases neural network is just a composition of layers, we can build a class that will allow us to stack layers together and make forward and backward passes through them without explicitly programming that logic. We will store the list of layers inside the `Net` class, and use `add()` function to add new layers:

```python
class Net:
    def __init__(self):
        self.layers = []
    
    def add(self,l):
        self.layers.append(l)
        
    def forward(self,x):
        for l in self.layers:
            x = l.forward(x)
        return x
    
    def backward(self,z):
        for l in self.layers[::-1]:
            z = l.backward(z)
        return z
    
    def update(self,lr):
        for l in self.layers:
            if 'update' in l.__dir__():
                l.update(lr)
```

With this `Net` class our model definition and training becomes more neat:

```python
net = Net()
net.add(Linear(2,2))
net.add(Softmax())
loss = CrossEntropyLoss()

def get_loss_acc(x,y,loss=CrossEntropyLoss()):
    p = net.forward(x)
    l = loss.forward(p,y)
    pred = np.argmax(p,axis=1)
    acc = (pred==y).mean()
    return l,acc

print("Initial loss={}, accuracy={}: ".format(*get_loss_acc(train_x,train_labels)))

def train_epoch(net, train_x, train_labels, loss=CrossEntropyLoss(), batch_size=4, lr=0.1):
    for i in range(0,len(train_x),batch_size):
        xb = train_x[i:i+batch_size]
        yb = train_labels[i:i+batch_size]

        p = net.forward(xb)
        l = loss.forward(p,yb)
        dp = loss.backward(l)
        dx = net.backward(dp)
        net.update(lr)
 
train_epoch(net,train_x,train_labels)
        
print("Final loss={}, accuracy={}: ".format(*get_loss_acc(train_x,train_labels)))
print("Test loss={}, accuracy={}: ".format(*get_loss_acc(test_x,test_labels)))
```

#### Plotting the Training Process

It would be nice to see visually how the network is being trained! We will define a `train_and_plot` function for that. To visualize the state of the network we will use level map, i.e. we will represent different values of the network output using different colors.

> Do not worry if you do not understand some of the plotting code below - it is more important to understand the underlying neural network concepts.

```python
def train_and_plot(n_epoch, net, loss=CrossEntropyLoss(), batch_size=4, lr=0.1):
    fig, ax = plt.subplots(2, 1)
    ax[0].set_xlim(0, n_epoch + 1)
    ax[0].set_ylim(0,1)

    train_acc = np.empty((n_epoch, 3))
    train_acc[:] = np.NAN
    valid_acc = np.empty((n_epoch, 3))
    valid_acc[:] = np.NAN

    for epoch in range(1, n_epoch + 1):

        train_epoch(net,train_x,train_labels,loss,batch_size,lr)
        tloss, taccuracy = get_loss_acc(train_x,train_labels,loss)
        train_acc[epoch-1, :] = [epoch, tloss, taccuracy]
        vloss, vaccuracy = get_loss_acc(test_x,test_labels,loss)
        valid_acc[epoch-1, :] = [epoch, vloss, vaccuracy]
        
        ax[0].set_ylim(0, max(max(train_acc[:, 2]), max(valid_acc[:, 2])) * 1.1)

        plot_training_progress(train_acc[:, 0], (train_acc[:, 2],
                                                 valid_acc[:, 2]), fig, ax[0])
        plot_decision_boundary(net, fig, ax[1])
        fig.canvas.draw()
        fig.canvas.flush_events()

    return train_acc, valid_acc
```

```python
import matplotlib.cm as cm

def plot_decision_boundary(net, fig, ax):
    draw_colorbar = True
    # remove previous plot
    while ax.collections:
        ax.collections.pop()
        draw_colorbar = False

    # generate countour grid
    x_min, x_max = train_x[:, 0].min() - 1, train_x[:, 0].max() + 1
    y_min, y_max = train_x[:, 1].min() - 1, train_x[:, 1].max() + 1
    xx, yy = np.meshgrid(np.arange(x_min, x_max, 0.1),
                         np.arange(y_min, y_max, 0.1))
    grid_points = np.c_[xx.ravel().astype('float32'), yy.ravel().astype('float32')]
    n_classes = max(train_labels)+1
    while train_x.shape[1] > grid_points.shape[1]:
        # pad dimensions (plot only the first two)
        grid_points = np.c_[grid_points,
                            np.empty(len(xx.ravel())).astype('float32')]
        grid_points[:, -1].fill(train_x[:, grid_points.shape[1]-1].mean())

    # evaluate predictions
    prediction = np.array(net.forward(grid_points))
    # for two classes: prediction difference
    if (n_classes == 2):
        Z = np.array([0.5+(p[0]-p[1])/2.0 for p in prediction]).reshape(xx.shape)
    else:
        Z = np.array([p.argsort()[-1]/float(n_classes-1) for p in prediction]).reshape(xx.shape)
    
    # draw contour
    levels = np.linspace(0, 1, 40)
    cs = ax.contourf(xx, yy, Z, alpha=0.4, levels = levels)
    if draw_colorbar:
        fig.colorbar(cs, ax=ax, ticks = [0, 0.5, 1])
    c_map = [cm.jet(x) for x in np.linspace(0.0, 1.0, n_classes) ]
    colors = [c_map[l] for l in train_labels]
    ax.scatter(train_x[:, 0], train_x[:, 1], marker='o', c=colors, s=60, alpha = 0.5)
```

```python
def plot_training_progress(x, y_data, fig, ax):
    styles = ['k--', 'g-']
    # remove previous plot
    while ax.lines:
        ax.lines.pop()
    # draw updated lines
    for i in range(len(y_data)):
        ax.plot(x, y_data[i], styles[i])
    ax.legend(ax.lines, ['training accuracy', 'validation accuracy'],
              loc='upper center', ncol = 2)
```

```python
%matplotlib nbagg 
net = Net()
net.add(Linear(2,2))
net.add(Softmax())

res = train_and_plot(30,net,lr=0.005)
```

After running the cell above you should be able to see interactively how the boundary between classes change during training. Note that we have chosen very small learning rate so that we can see how the process happens.

#### Multi-Layered Models

The network above has been constructed from several layers, but we still had only one `Linear` layer, which does the actual classification. What happens if we decide to add several such layers?

Surprisingly, our code will work! Very important thing to note, however, is that in between linear layers we need to have a non-linear **activation function**, such as `tanh`. Without such non-linearity, several linear layers would have the same expressive power as just one layers - because composition of linear functions is also linear!

```python
class Tanh:
    def forward(self,x):
        y = np.tanh(x)
        self.y = y
        return y
    def backward(self,dy):
        return (1.0-self.y**2)*dy
```

 Adding several layers make sense, because unlike one-layer network, multi-layered model will be able to accuratley classify sets that are not linearly separable. I.e., a model with several layers will be **reacher**.

> It can be demonstrated that with sufficient number of neurons a two-layered model is capable to classifying any convex set of data points, and three-layered network can classify virtually any set.

Mathematically, multi-layered perceptron would be represented by a more complex function $f_\theta$ that can be computed in several steps:
* $z_1 = W_1\times x+b_1$
* $z_2 = W_2\times\alpha(z_1)+b_2$
* $f = \sigma(z_2)$

Here, $\alpha$ is a **non-linear activation function**, $\sigma$ is a softmax function, and $\theta=\langle W_1,b_1,W_2,b_2\rangle$ are parameters.

The gradient descent algorithm would remain the same, but it would be more difficult to calculate gradients. Given the
 chain differentiation rule, we can calculate derivatives as:

$$\begin{align}
\frac{\partial\mathcal{L}}{\partial W_2} &= \color{red}{\frac{\partial\mathcal{L}}{\partial\sigma}\frac{\partial\sigma}{\partial z_2}}\color{black}{\frac{\partial z_2}{\partial W_2}} \\
\frac{\partial\mathcal{L}}{\partial W_1} &= \color{red}{\frac{\partial\mathcal{L}}{\partial\sigma}\frac{\partial\sigma}{\partial z_2}}\color{black}{\frac{\partial z_2}{\partial\alpha}\frac{\partial\alpha}{\partial z_1}\frac{\partial z_1}{\partial W_1}}
\end{align}
$$

Note that the beginning of all those expressions is still the same, and thus we can continue back propagation beyond one linear layers to adjust further weights up the computational graph.

Let's now experiment with two-layered network:

```python
net = Net()
net.add(Linear(2,10))
net.add(Tanh())
net.add(Linear(10,2))
net.add(Softmax())
loss = CrossEntropyLoss()
```

```python
res = train_and_plot(30,net,lr=0.01)
```

#### Why Not Always Use Multi-Layered Model?

We have seen that multi-layered model is more *powerful* and *expressive*, than one-layered one. You may be wondering why don't we always use many-layered model. The answer to this question is **overfitting**.

We will deal with this term more in a later sections, but the idea is the following: **the more powerful the model is, the better it can approximate training data, and the more data it needs to properly generalize** for the new data it has not seen before.

**A linear model:**
* We are likely to get high training loss - so-called **underfitting**, when the model does not have enough power to correctly separate all data. 
* Valiadation loss and training loss are more or less the same. The model is likely to generalize well to test data.

**Complex multi-layered model**
* Low training loss - the model can approximate training data well, because it has enough expressive power.
* Validation loss can be much higher than training loss and can start to increase during training - this is because the model "memorizes" training points, and loses the "overall picture"

![Overfitting](images/overfit.png)

> On this picture, `x` stands for training data, `o` - validation data. Left - linear model (one-layer), it approximates the nature of the data pretty well. Right - overfitted model, the model perfectly well approximates training data, but stops making sense with any other data (validation error is very high)

#### Takeaways

* Simple models (fewer layers, fewer neurons) with low number of parameters ("low capacity") are less likely to overfit
* More complex models (more layers, more neurons on each layer, high capacity) are likely to overfit. We need to monitor validation error to make sure it does not start to rise with further training
* More complex models need more data to train on.
* You can solve overfitting problem by either:
    - simplifying your model
    - increasing the amount of training data
* **Bias-variance trade-off** is a term that shows that you need to get the compromise
    - between power of the model and amount of data,
    - between overfittig and underfitting
* There is not single recipe on how many layers of parameters you need - the best way is to experiment

#### Credits

This notebook is a part of [AI for Beginners Curricula](http://github.com/microsoft/ai-for-beginners), and has been prepared by [Dmitry Soshnikov](http://soshnikov.com). It is inspired by Neural Network Workshop at Microsoft Research Cambridge. Some code and illustrative materials are taken from presentations by [Katja Hoffmann](https://www.microsoft.com/en-us/research/people/kahofman/), [Matthew Johnson](https://www.microsoft.com/en-us/research/people/matjoh/) and [Ryoto Tomioka](https://www.microsoft.com/en-us/research/people/ryoto/), and from [NeuroWorkshop](http://github.com/shwars/NeuroWorkshop) repository.

### Introduction to Neural Networks. Multi-Layered Perceptron

In the previous section, you learned about the simplest neural network model - one-layered perceptron, a linear two-class classification model.

In this section we will extend this model into a more flexible framework, allowing us to:

* perform **multi-class classification** in addition to two-class
* solve **regression problems** in addition to classification
* separate classes that are not linearly separable

We will also develop our own modular framework in Python that will allow us to construct different neural network architectures.

#### Formalization of Machine Learning

Let's start with formalizing the Machine Learning problem. Suppose we have a training dataset **X** with labels **Y**, and we need to build a model *f* that will make most accurate predictions. The quality of predictions is measured by **Loss function** &lagran;. The following loss functions are often used:

* For regression problem, when we need to predict a number, we can use **absolute error** &sum;<sub>i</sub>|f(x<sup>(i)</sup>)-y<sup>(i)</sup>|, or **squared error** &sum;<sub>i</sub>(f(x<sup>(i)</sup>)-y<sup>(i)</sup>)<sup>2</sup>
* For classification, we use **0-1 loss** (which is essentially the same as **accuracy** of the model), or **logistic loss**.

For one-level perceptron, function *f* was defined as a linear function *f(x)=wx+b* (here *w* is the weight matrix, *x* is the vector of input features, and *b* is bias vector). For different neural network architectures, this function can take more complex form.

> In the case of classification, it is often desirable to get probabilities of corresponding classes as network output. To convert arbitrary numbers to probabilities (eg. to normalize the output), we often use **softmax** function &sigma;, and the function *f* becomes *f(x)=&sigma;(wx+b)*

In the definition of *f* above, *w* and *b* are called **parameters** &theta;=⟨*w,b*⟩. Given the dataset ⟨**X**,**Y**⟩, we can compute an overall error on the whole dataset as a function of parameters &theta;.

> ✅ **The goal of neural network training is to minimize the error by varying parameters &theta;**

#### Gradient Descent Optimization

There is a well-known method of function optimization called **gradient descent**. The idea is that we can compute a derivative (in multi-dimensional case called **gradient**) of loss function with respect to parameters, and vary parameters in such a way that the error would decrease. This can be formalized as follows:

* Initialize parameters by some random values w<sup>(0)</sup>, b<sup>(0)</sup>
* Repeat the following step many times:
    - w<sup>(i+1)</sup> = w<sup>(i)</sup>-&eta;&part;&lagran;/&part;w
    - b<sup>(i+1)</sup> = b<sup>(i)</sup>-&eta;&part;&lagran;/&part;b

During training, the optimization steps are supposed to be calculated considering the whole dataset (remember that loss is calculated as a sum through all training samples). However, in real life we take small portions of the dataset called **minibatches**, and calculate gradients based on a subset of data. Because subset is taken randomly each time, such method is called **stochastic gradient descent** (SGD).

#### Multi-Layered Perceptrons and Backpropagation

One-layer network, as we have seen above, is capable of classifying linearly separable classes. To build a richer model, we can combine several layers of the network. Mathematically it would mean that the function *f* would have a more complex form, and will be computed in several steps:
* z<sub>1</sub>=w<sub>1</sub>x+b<sub>1</sub>
* z<sub>2</sub>=w<sub>2</sub>&alpha;(z<sub>1</sub>)+b<sub>2</sub>
* f = &sigma;(z<sub>2</sub>)

Here, &alpha; is a **non-linear activation function**, &sigma; is a softmax function, and parameters &theta;=<*w<sub>1</sub>,b<sub>1</sub>,w<sub>2</sub>,b<sub>2</sub>*>.

The gradient descent algorithm would remain the same, but it would be more difficult to calculate gradients. Given the chain differentiation rule, we can calculate derivatives as:

* &part;&lagran;/&part;w<sub>2</sub> = (&part;&lagran;/&part;&sigma;)(&part;&sigma;/&part;z<sub>2</sub>)(&part;z<sub>2</sub>/&part;w<sub>2</sub>)
* &part;&lagran;/&part;w<sub>1</sub> = (&part;&lagran;/&part;&sigma;)(&part;&sigma;/&part;z<sub>2</sub>)(&part;z<sub>2</sub>/&part;&alpha;)(&part;&alpha;/&part;z<sub>1</sub>)(&part;z<sub>1</sub>/&part;w<sub>1</sub>)

> ✅ The chain differentiation rule is used to calculate derivatives of the loss function with respect to parameters.

Note that the left-most part of all those expressions is the same, and thus we can effectively calculate derivatives starting from the loss function and going "backwards" through the computational graph. Thus the method of training a multi-layered perceptron is called **backpropagation**, or 'backprop'.

<img alt="compute graph" src="images/ComputeGraphGrad.png"/>

> TODO: image citation

> ✅ We will cover backprop in much more detail in our notebook example.  

#### Conclusion

In this lesson, we have built our own neural network library, and we have used it for a simple two-dimensional classification task.

#### 🚀 Challenge

In the accompanying notebook, you will implement your own framework for building and training multi-layered perceptrons. You will be able to see in detail how modern neural networks operate.

Proceed to the [OwnFramework](OwnFramework.ipynb) notebook and work through it.

#### Review & Self Study

Backpropagation is a common algorithm used in AI and ML, worth studying [in more detail](https://wikipedia.org/wiki/Backpropagation)

#### Simplest Introduction to Neural Networks with Keras

> This notebook is a part of [AI for Beginners Curricula](http://github.com/microsoft/ai-for-beginners). Visit the repository for complete set of learning materials.

##### Neural Frameworks

There are several frameworks for training neural networks. However, if you want to get started fast and not go into much detail on how things work internally - you should consider using [Keras](https://keras.io/). This short tutorial will get you started, and if you want to get deeper into understanding how things work - look into [Introduction to Tensorflow and Keras](IntroKerasTF.ipynb) notebook.

##### Getting things ready

Keras is a part of Tensorflow 2.x framework. Let's make sure we have version 2.x.x of Tensorflow installed:
```
pip install tensorflow
```
or
```
conda install tensorflow
```

```python
import tensorflow as tf
from tensorflow import keras
import numpy as np
from sklearn.datasets import make_classification
import matplotlib.pyplot as plt
print(f'Tensorflow version = {tf.__version__}')
print(f'Keras version = {keras.__version__}')
```

#### Basic Concepts: Tensor

**Tensor** is a multi-dimensional array. It is very convenient to use tensors to represent different types of data:
* 400x400 - black-and-white picture
* 400x400x3 - color picture 
* 16x400x400x3 - minibatch of 16 color pictures
* 25x400x400x3 - one second of 25-fps video
* 8x25x400x400x3 - minibatch of 8 1-second videos

Tensors give us a convenient way to represent input/output data, as well we weights inside the neural network.

#### Sample Problem

Let's consider binary classification problem. A good example of such a problem would be a tumour classification between malignant and benign based on it's size and age. Let's start by generating some sample data:

```python
np.random.seed(0) # pick the seed for reproducibility - change it to explore the effects of random variations

n = 100
X, Y = make_classification(n_samples = n, n_features=2,
                           n_redundant=0, n_informative=2, flip_y=0.05,class_sep=1.5)
X = X.astype(np.float32)
Y = Y.astype(np.int32)

split = [ 70*n//100 ]
train_x, test_x = np.split(X, split)
train_labels, test_labels = np.split(Y, split)
```

```python
def plot_dataset(features, labels, W=None, b=None):
    # prepare the plot
    fig, ax = plt.subplots(1, 1)
    ax.set_xlabel('$x_i[0]$ -- (feature 1)')
    ax.set_ylabel('$x_i[1]$ -- (feature 2)')
    colors = ['r' if l else 'b' for l in labels]
    ax.scatter(features[:, 0], features[:, 1], marker='o', c=colors, s=100, alpha = 0.5)
    if W is not None:
        min_x = min(features[:,0])
        max_x = max(features[:,1])
        min_y = min(features[:,1])*(1-.1)
        max_y = max(features[:,1])*(1+.1)
        cx = np.array([min_x,max_x],dtype=np.float32)
        cy = (0.5-W[0]*cx-b)/W[1]
        ax.plot(cx,cy,'g')
        ax.set_ylim(min_y,max_y)
    fig.show()
```

```python
plot_dataset(train_x, train_labels)
```

#### Normalizing Data

Before training, it is common to bring our input features to the standard range of [0,1] (or [-1,1]). The exact reasons for that we will discuss later in the course, but in short the reason is the following. We want to avoid values that flow through our network getting too big or too small, and we normally agree to keep all values in the small range close to 0. Thus we initialize the weights with small random numbers, and we keep signals in the same range.

When normalizing data, we need to subtract min value and divide by range. We compute min value and range using training data, and then normalize test/validation dataset using the same min/range values from the training set. This is because in real life we will only know the training set, and not all incoming new values that the network would be asked to predict. Occasionally, the new value may fall out of the [0,1] range, but that's not crucial.  

```python
train_x_norm = (train_x-np.min(train_x,axis=0)) / (np.max(train_x,axis=0)-np.min(train_x,axis=0))
test_x_norm = (test_x-np.min(train_x,axis=0)) / (np.max(train_x,axis=0)-np.min(train_x,axis=0))
```

#### Training One-Layer Network (Perceptron)

In many cases, a neural network would be a sequence of layers. It can be defined in Keras using `Sequential` model in the following manner:

```python
model = keras.models.Sequential()
model.add(keras.Input(shape=(2,)))
model.add(keras.layers.Dense(1))
model.add(keras.layers.Activation(keras.activations.sigmoid))

model.summary()
```

Here, we first create the model, and then add layers to it:
* First `Input` layer (which is not strictly speaking a layer) contains the specification of network's input size
* `Dense` layer is the actual perceptron that contains trainable weights
* Finally, there is a layer with *sigmoid* `Activation` function to bring the result of the network into 0-1 range (to make it a probability).

Input size, as well as activation function, can also be specified directly in the `Dense` layer for brevity: 

```python
model = keras.models.Sequential()
model.add(keras.layers.Dense(1,input_shape=(2,),activation='sigmoid'))
model.summary()
```

Before training the model, we need to **compile it**, which essentially mean specifying:
* **Loss function**, which defines how loss is calculated. Because we have two-class classification problem, we will use *binary cross-entropy loss*.
* **Optimizer** to use. The simplest option would be to use `sgd` for *stochastic gradient descent*, or you can use more sophisticated optimizers such as `adam`.
* **Metrics** that we want to use to measure success of our training. Since it is classification task, a good metrics would be `Accuracy` (or `acc` for short)

We can specify loss, metrics and optimizer either as strings, or by providing some objects from Keras framework. In our example, we need to specify `learning_rate` parameter to fine-tune learning speed of our model, and thus we provide full name of Keras SGD optimizer.

```python
model.compile(optimizer=keras.optimizers.SGD(learning_rate=0.2),loss='binary_crossentropy',metrics=['acc'])
```

After compiling the model, we can do the actual training by calling `fit` method. The most important parameters are:
* `x` and `y` specify training data, features and labels respectively
* If we want validation to be performed on each epoch, we can specify `validation_data` parameter, which would be a tuple of features and labels
* `epochs` specified the number of epochs
* If we want training to happen in minibatches, we can specify `batch_size` parameter. You can also pre-batch the data manually before passing it to `x`/`y`/`validation_data`, in which case you do not need `batch_size`

```python
model.fit(x=train_x_norm,y=train_labels,validation_data=(test_x_norm,test_labels),epochs=10,batch_size=1)
```

You can try to experiment with different training parameters to see how they affect the training:
* Setting `batch_size` to be too large (or not specifying it at all) may result in less stable training, because with low-dimensional data small batch sizes provide more precise direction of the gradient for each specific case
* Too high `learning_rate` may result in overfitting, or in less stable results, while too low learning rate means it will take more epochs to achieve the result

> Note that you can call `fit` function several times in a row to further train the network. If you want to start training from scratch - you need to re-run the cell with the model definition. 

To make sure our training worked, let's plot the line that separates two classes. Separation line is defined by the equation $W\times x + b = 0.5$

```python
plot_dataset(train_x,train_labels,model.layers[0].weights[0],model.layers[0].weights[1])
```

#### Plotting the training graphs

`fit` function returns `history` object as a result, which can be used to observe loss and metrics on each epoch. In the example below, we will re-start the training with small learning rate, and will observe how the loss and accuracy behave.

> **Note** that we are using slightly different syntax for defining `Sequential` model. Instead of `add`-ing layers one by one, we can also specify the list of layers right when creating the model in the first place - this is a bit shorter syntax, and you may prefer to use it.

```python
model = keras.models.Sequential([
    keras.layers.Dense(1,input_shape=(2,),activation='sigmoid')])
model.compile(optimizer=keras.optimizers.SGD(learning_rate=0.05),loss='binary_crossentropy',metrics=['acc'])
hist = model.fit(x=train_x_norm,y=train_labels,validation_data=(test_x_norm,test_labels),epochs=10,batch_size=1)
```

```python
plt.plot(hist.history['acc'])
plt.plot(hist.history['val_acc'])
```

#### Multi-Class Classification

If you need to solve a problem of multi-class classification, your network would have more that one output - corresponding to the number of classes $C$. Each output will contain the probability of a given class.

> Note that you can also use a network with two outputs to perform binary classification in the same manner. That is exactly what we will demonstrate now.

When you expect a network to output a set of probabilities $p_1,\dots, p_C$, we need all of them to add up to 1. To ensure this, we use `softmax` as a final activation function on the last layer. **Softmax** takes a vector input, and makes sure that all components of that vector are transformed into probabilities.

Also, since the output of the network is a $C$-dimensional vector, we need labels to have the same form. This can be achieved by using **one-hot encoding**, when the number of a class $i$ is converted to a vector of zeroes, with 1 at the $i$-th position.

To compare the probability output of the neural network with expected one-hot-encoded label, we use **cross-entropy loss** function. It takes two probability distributions, and outputs a value of how different they are.

So, to summarize what we need to do for multi-class classification with $C$ classes:
* The network should have $C$ neurons in the last layer
* Last activation function should be **softmax**
* Loss should be **cross-entropy loss**
* Labels should be converted to **one-hot encoding** (this can be done using `numpy`, or using Keras utils `to_categorical`)

```python
model = keras.models.Sequential([
    keras.layers.Dense(5,input_shape=(2,),activation='relu'),
    keras.layers.Dense(2,activation='softmax')
])
model.compile(keras.optimizers.Adam(0.01),'categorical_crossentropy',['acc'])

# Two ways to convert to one-hot encoding
train_labels_onehot = keras.utils.to_categorical(train_labels)
test_labels_onehot = np.eye(2)[test_labels]

hist = model.fit(x=train_x_norm,y=train_labels_onehot,
                 validation_data=[test_x_norm,test_labels_onehot],batch_size=1,epochs=10)
```

##### Sparse Categorical Cross-Entropy

Often labels in multi-class classification are represented by class numbers. Keras also supports another kind of loss function called **sparse categorical crossentropy**, which expects class number to be integers, and not one-hot vectors. Using this kind of loss function, we can simplify our training code:

```python
model.compile(keras.optimizers.Adam(0.01),'sparse_categorical_crossentropy',['acc'])
model.fit(x=train_x_norm,y=train_labels,validation_data=[test_x_norm,test_labels],batch_size=1,epochs=10)
```

#### Multi-Label Classification

Sometime we have cases when our objects can belong to two classes at once. As an example, suppose we want to develop a classifier for cats and dogs on the picture, but we also want to allow cases when both cats and dogs are present.

With multi-label classification, instead of one-hot encoded vector, we will have a vector that has 1 in position corresponding to all classes relevant to the input sample. Thus, output of the network should not have normalized probabilities for all classes, but rather for each class individually - which corresponds to using **sigmoid** activation function. Cross-entropy loss can still be used as a loss function.

> **Note** that this is very similar to using **different neural networks** to do binary classification for each particular class - only the initial part of the network (up to final classification layer) is shared for all classes.

#### Summary of Classification Loss Functions

We have seen that binary, multi-class and multi-label classification differ by the type of loss function and activation function on the last layer of the network. It may all be a little bit confusing if you are just starting to learn, but here are a few rules to keep in mind:
* If the network has one output (**binary classification**), we use **sigmoid** activation function, for **multiclass classification** - **softmax**
* If the output class is represented as one-hot-encoding, the loss function will be **cross entropy loss** (categorical cross-entropy), if the output contains class number - **sparse categorical cross-entropy**.  For **binary classification** - use **binary cross-entropy** (same as **log loss**)
* **Multi-label classification** is when we can have an object belonging to several classes at the same time. In this case, we need to encode labels using one-hot encoding, and use **sigmoid** as activation function, so that each class probability is between 0 and 1.

| Classification | Label Format | Activation Function | Loss |
|---------------|-----------------------|-----------------|----------|
| Binary      | Probability of 1st class | sigmoid | binary crossentropy |
| Binary      | One-hot encoding (2 outputs) | softmax | categorical crossentropy |
| Multiclass |  One-hot encoding | softmax | categorical crossentropy |
| Multiclass | Class Number | softmax | sparse categorical crossentropy |
| Multilabel | One-hot encoding | sigmoid | categorical crossentropy |

**Task**: 
Use Keras to train a classifier for MNIST handwritten digits:
* Notice that Keras contains some standard datasets, including MNIST. To use MNIST from Keras, you only need a couple of lines of code (more information [here](https://www.tensorflow.org/api_docs/python/tf/keras/datasets/mnist))
* Try several network configuration, with different number of layers/neurons, activation functions.

What is the best accuracy you were able to achieve?

#### Takeaways

* **Keras** is really recommended for beginners, because it allows to construct networks from layers quite easily, and then train it with just a couple of lines of code
* If non-standard architecture is needed, you would need to learn a bit deeper into Tensorflow. Or you can ask someone to implement custom logic as a Keras layer, and then use it in Keras models
* It is a good idea to look at PyTorch as well and compare approaches. 

A good sample notebook from the creator of Keras on Keras and Tensorflow 2.0 can be found [here](https://t.co/k694J95PI8).

---

**📓 Notebook 代码**（来自 `lessons/3-NeuralNetworks/05-Frameworks/IntroKerasTF.ipynb`）:

#### Introduction to Tensorflow and Keras

> This notebook is a part of [AI for Beginners Curricula](http://github.com/microsoft/ai-for-beginners). Visit the repository for complete set of learning materials.

##### Neural Frameworks

We have learnt that to train neural networks you need:
* Quickly multiply matrices (tensors)
* Compute gradients to perform gradient descent optimization

What neural network frameworks allow you to do:
* Operate with tensors on whatever compute is available, CPU or GPU, or even TPU
* Automatically compute gradients (they are explicitly programmed for all built-in tensor functions)

Optionally:
* Neural Network constructor / higher level API (describe network as a sequence of layers)
* Simple training functions (`fit`, as in Scikit Learn)
* A number of optimization algorithms in addition to gradient descent
* Data handling abstractions (that will ideally work on GPU, too)

##### Most Popular Frameworks

* Tensorflow 1.x - first widely available framework (Google). Allowed to define static computation graph, push it to GPU, and explicitly evaluate it
* PyTorch - a framework from Facebook that is growing in popularity
* Keras - higher level API on top of Tensorflow/PyTorch to unify and simplify using neural networks (Francois Chollet)
* Tensorflow 2.x + Keras - new version of Tensorflow with integrated Keras functionality, which supports **dynamic computation graph**, allowing to perform tensor operations very similar to numpy (and PyTorch)

We will consider Tensorflow 2.x and Keras. Make sure you have version 2.x.x of Tensorflow installed:
```
pip install tensorflow
```
or
```
conda install tensorflow
```

```python
import tensorflow as tf
import numpy as np
print(tf.__version__)
```

#### Basic Concepts: Tensor

**Tensor** is a multi-dimensional array. It is very convenient to use tensors to represent different types of data:
* 400x400 - black-and-white picture
* 400x400x3 - color picture 
* 16x400x400x3 - minibatch of 16 color pictures
* 25x400x400x3 - one second of 25-fps video
* 8x25x400x400x3 - minibatch of 8 1-second videos

##### Simple Tensors

You can easily create simple tensors from lists of np-arrays, or generate random ones:

```python
a = tf.constant([[1,2],[3,4]])
print(a)
a = tf.random.normal(shape=(10,3))
print(a)
```

You can use arithmetic operations on tensors, which are performed element-wise, as in numpy. Tensors are automatically expanded to required dimension, if needed. To extract numpy-array from tensor, use `.numpy()`:

```python
print(a-a[0])
print(tf.exp(a)[0].numpy())
```

#### Variables

Variables are useful to represent tensor values that can be modified using `assign` and `assign_add`. They are often used to represent neural network weights.

As an example, here is a silly way to get a sum of all rows of tensor `a`:

```python
s = tf.Variable(tf.zeros_like(a[0]))
for i in a:
  s.assign_add(i)

print(s)
```

Much better way to do it:

```python
tf.reduce_sum(a,axis=0)
```

#### Computing Gradients

For back propagation, you need to compute gradients. This is done using `tf.GradientTape()` idiom:
 * Add `with tf.GradientTape` block around our computations
 * Mark those tensors with respect to which we need to compute gradients by calling `tape.watch` (all variables are watched automatically)
 * Compute whatever we need (build computational graph)
 * Obtain gradients using `tape.gradient` 

```python
a = tf.random.normal(shape=(2, 2))
b = tf.random.normal(shape=(2, 2))

with tf.GradientTape() as tape:
  tape.watch(a)  # Start recording the history of operations applied to `a`
  c = tf.sqrt(tf.square(a) + tf.square(b))  # Do some math using `a`
  # What's the gradient of `c` with respect to `a`?
  dc_da = tape.gradient(c, a)
  print(dc_da)
```

#### Example 1: Linear Regression

Now we know enough to solve the classical problem of **Linear regression**. Let's generate small synthetic dataset:

```python
import matplotlib.pyplot as plt
from sklearn.datasets import make_classification, make_regression
from sklearn.model_selection import train_test_split
import random
```

```python
np.random.seed(13) # pick the seed for reproducability - change it to explore the effects of random variations

train_x = np.linspace(0, 3, 120)
train_labels = 2 * train_x + 0.9 + np.random.randn(*train_x.shape) * 0.5

plt.scatter(train_x,train_labels)
```

Linear regression is defined by a straight line $f_{W,b}(x) = Wx+b$, where $W, b$ are model parameters that we need to find. An error on our dataset $\{x_i,y_u\}_{i=1}^N$ (also called **loss function**) can be defined as mean square error:
$$
\mathcal{L}(W,b) = {1\over N}\sum_{i=1}^N (f_{W,b}(x_i)-y_i)^2
$$

Let's define our model and loss function:

```python
input_dim = 1
output_dim = 1
learning_rate = 0.1

# This is our weight matrix
w = tf.Variable([[100.0]])
# This is our bias vector
b = tf.Variable(tf.zeros(shape=(output_dim,)))

def f(x):
  return tf.matmul(x,w) + b

def compute_loss(labels, predictions):
  return tf.reduce_mean(tf.square(labels - predictions))
```

We will train the model on a series of minibatches. We will use gradient descent, adjusting model parameters using the following formulae:
$$
\begin{array}{l}
W^{(n+1)}=W^{(n)}-\eta\frac{\partial\mathcal{L}}{\partial W} \\
b^{(n+1)}=b^{(n)}-\eta\frac{\partial\mathcal{L}}{\partial b} \\
\end{array}
$$

```python
def train_on_batch(x, y):
  with tf.GradientTape() as tape:
    predictions = f(x)
    loss = compute_loss(y, predictions)
    # Note that `tape.gradient` works with a list as well (w, b).
    dloss_dw, dloss_db = tape.gradient(loss, [w, b])
  w.assign_sub(learning_rate * dloss_dw)
  b.assign_sub(learning_rate * dloss_db)
  return loss
```

Let's do the training. We will do several passes through the dataset (so-called **epochs**), divide it into minibatches and call the function defined above:

```python
# Shuffle the data.
indices = np.random.permutation(len(train_x))
features = tf.constant(train_x[indices],dtype=tf.float32)
labels = tf.constant(train_labels[indices],dtype=tf.float32)
```

```python
batch_size = 4
for epoch in range(10):
  for i in range(0,len(features),batch_size):
    loss = train_on_batch(tf.reshape(features[i:i+batch_size],(-1,1)),tf.reshape(labels[i:i+batch_size],(-1,1)))
  print('Epoch %d: last batch loss = %.4f' % (epoch, float(loss)))
```

We now have obtained optimized parameters $W$ and $b$. Note that their values are similar to the original values used when generating the dataset ($W=2, b=1$)

```python
w,b
```

```python
plt.scatter(train_x,train_labels)
x = np.array([min(train_x),max(train_x)])
y = w.numpy()[0,0]*x+b.numpy()[0]
plt.plot(x,y,color='red')
```

#### Computational Graph and GPU Computations

Whenever we compute tensor expression, Tensorflow builds a computational graph that can be computed on the available computing device, e.g. CPU or GPU. Since we were using arbitrary Python function in our code, they cannot be included as part of computational graph, and thus when running our code on GPU we would need to pass the data between CPU and GPU back and forth, and compute custom function on CPU.

Tensorflow allows us to mark our Python function using `@tf.function` decorator, which will make this function a part of the same computational graph. This decorator can be applied to functions that use standard Tensorflow tensor operations. 

```python
@tf.function
def train_on_batch(x, y):
  with tf.GradientTape() as tape:
    predictions = f(x)
    loss = compute_loss(y, predictions)
    # Note that `tape.gradient` works with a list as well (w, b).
    dloss_dw, dloss_db = tape.gradient(loss, [w, b])
  w.assign_sub(learning_rate * dloss_dw)
  b.assign_sub(learning_rate * dloss_db)
  return loss
```

The code has not changed, but if you were running this code on GPU and on larger dataset - you would have noticed the difference in speed. 

#### Dataset API

Tensorflow contains a convenient API to work with data. Let's try to use it. We will also train our model from scratch.

```python
w.assign([[10.0]])
b.assign([0.0])

# Create a tf.data.Dataset object for easy batched iteration
dataset = tf.data.Dataset.from_tensor_slices((train_x.astype(np.float32), train_labels.astype(np.float32)))
dataset = dataset.shuffle(buffer_size=1024).batch(256)

for epoch in range(10):
  for step, (x, y) in enumerate(dataset):
    loss = train_on_batch(tf.reshape(x,(-1,1)), tf.reshape(y,(-1,1)))
  print('Epoch %d: last batch loss = %.4f' % (epoch, float(loss)))
```

#### Example 2: Classification

Now we will consider binary classification problem. A good example of such a problem would be a tumour classification between malignant and benign based on it's size and age.

The core model is similar to regression, but we need to use different loss function. Let's start by generating sample data:

```python
np.random.seed(0) # pick the seed for reproducibility - change it to explore the effects of random variations

n = 100
X, Y = make_classification(n_samples = n, n_features=2,
                           n_redundant=0, n_informative=2, flip_y=0.05,class_sep=1.5)
X = X.astype(np.float32)
Y = Y.astype(np.int32)

split = [ 70*n//100, (15+70)*n//100 ]
train_x, valid_x, test_x = np.split(X, split)
train_labels, valid_labels, test_labels = np.split(Y, split)
```

```python
def plot_dataset(features, labels, W=None, b=None):
    # prepare the plot
    fig, ax = plt.subplots(1, 1)
    ax.set_xlabel('$x_i[0]$ -- (feature 1)')
    ax.set_ylabel('$x_i[1]$ -- (feature 2)')
    colors = ['r' if l else 'b' for l in labels]
    ax.scatter(features[:, 0], features[:, 1], marker='o', c=colors, s=100, alpha = 0.5)
    if W is not None:
        min_x = min(features[:,0])
        max_x = max(features[:,1])
        min_y = min(features[:,1])*(1-.1)
        max_y = max(features[:,1])*(1+.1)
        cx = np.array([min_x,max_x],dtype=np.float32)
        cy = (0.5-W[0]*cx-b)/W[1]
        ax.plot(cx,cy,'g')
        ax.set_ylim(min_y,max_y)
    fig.show()
```

```python
plot_dataset(train_x, train_labels)
```

#### Normalizing Data

Before training, it is common to bring our input features to the standard range of [0,1] (or [-1,1]). The exact reasons for that we will discuss later in the course, but in short the reason is the following. We want to avoid values that flow through our network getting too big or too small, and we normally agree to keep all values in the small range close to 0. Thus we initialize the weights with small random numbers, and we keep signals in the same range.

When normalizing data, we need to subtract min value and divide by range. We compute min value and range using training data, and then normalize test/validation dataset using the same min/range values from the training set. This is because in real life we will only know the training set, and not all incoming new values that the network would be asked to predict. Occasionally, the new value may fall out of the [0,1] range, but that's not crucial.  

```python
train_x_norm = (train_x-np.min(train_x)) / (np.max(train_x)-np.min(train_x))
valid_x_norm = (valid_x-np.min(train_x)) / (np.max(train_x)-np.min(train_x))
test_x_norm = (test_x-np.min(train_x)) / (np.max(train_x)-np.min(train_x))
```

#### Training One-Layer Perceptron

Let's use Tensorflow gradient computing machinery to train one-layer perceptron.

Our neural network will have 2 inputs and 1 output. The weight matrix $W$ will have size $2\times1$, and bias vector $b$ -- $1$.

Core model will be the same as in previous example, but loss function will be a logistic loss. To apply logistic loss, we need to get the value of **probability** as the output of our network, i.e. we need to bring the output $z$ to the range [0,1] using `sigmoid` activation function: $p=\sigma(z)$.

If we get the probability $p_i$ for the i-th input value corresponding to the actual class $y_i\in\{0,1\}$, we compute the loss as $\mathcal{L_i}=-(y_i\log p_i + (1-y_i)log(1-p_i))$. 

In Tensorflow, both those steps (applying sigmoid and then logistic loss) can be done using one call to `sigmoid_cross_entropy_with_logits` function. Since we are training our network in minibatches, we need to average out the loss across all elements of a minibatch using `reduce_mean`: 

```python
W = tf.Variable(tf.random.normal(shape=(2,1)),dtype=tf.float32)
b = tf.Variable(tf.zeros(shape=(1,),dtype=tf.float32))

learning_rate = 0.1

@tf.function
def train_on_batch(x, y):
  with tf.GradientTape() as tape:
    z = tf.matmul(x, W) + b
    loss = tf.reduce_mean(tf.nn.sigmoid_cross_entropy_with_logits(labels=y,logits=z))
  dloss_dw, dloss_db = tape.gradient(loss, [W, b])
  W.assign_sub(learning_rate * dloss_dw)
  b.assign_sub(learning_rate * dloss_db)
  return loss
```

We will use minibatches of 16 elements, and do a few epochs of training:

```python
# Create a tf.data.Dataset object for easy batched iteration
dataset = tf.data.Dataset.from_tensor_slices((train_x_norm.astype(np.float32), train_labels.astype(np.float32)))
dataset = dataset.shuffle(128).batch(2)

for epoch in range(10):
  for step, (x, y) in enumerate(dataset):
    loss = train_on_batch(x, tf.expand_dims(y,1))
  print('Epoch %d: last batch loss = %.4f' % (epoch, float(loss)))
```

To make sure our training worked, let's plot the line that separates two classes. Separation line is defined by the equation $W\times x + b = 0.5$

```python
plot_dataset(train_x,train_labels,W.numpy(),b.numpy())
```

Let's see how our model behaves on the validation data.

```python
pred = tf.matmul(test_x,W)+b
fig,ax = plt.subplots(1,2)
ax[0].scatter(test_x[:,0],test_x[:,1],c=pred[:,0]>0.5)
ax[1].scatter(test_x[:,0],test_x[:,1],c=valid_labels)
```

To compute the accuracy on the validation data, we can cast boolean type to float, and compute the mean:

```python
tf.reduce_mean(tf.cast(((pred[0]>0.5)==test_labels),tf.float32))
```

Let's explain what goes on here:
* `pred` is the values predicted by the network. They are not quite probabilities, because we have not used an activation function, but values greater than 0.5 correspond to class 1, and smaller - to class 0.
*  `pred[0]>0.5` creates a boolean tensor of results, where `True` corresponds to class 1, and `False` - to class 0
* We compare that tensor to expected labels `valid_labels`, getting the boolean vector or correct predictions, where `True` corresponds to the correct prediction, and `False` - to incorrect one.
* We convert that tensor to floating point using `tf.cast`
* We then compute the mean value using `tf.reduce_mean` - that is exactly our desired accuracy  

#### Using TensorFlow/Keras Optimizers

Tensorflow is closely integrated with Keras, which contains a lot of useful functionality. For example, we can use different **optimization algorithms**. Let's do that, and also print obtained accuracy during training.

```python
optimizer = tf.keras.optimizers.Adam(0.01)

W = tf.Variable(tf.random.normal(shape=(2,1)))
b = tf.Variable(tf.zeros(shape=(1,),dtype=tf.float32))

@tf.function
def train_on_batch(x, y):
  vars = [W, b]
  with tf.GradientTape() as tape:
    z = tf.sigmoid(tf.matmul(x, W) + b)
    loss = tf.reduce_mean(tf.keras.losses.binary_crossentropy(z,y))
    correct_prediction = tf.equal(tf.round(y), tf.round(z))
    acc = tf.reduce_mean(tf.cast(correct_prediction, tf.float32))
    grads = tape.gradient(loss, vars)
    optimizer.apply_gradients(zip(grads,vars))
  return loss,acc

for epoch in range(20):
  for step, (x, y) in enumerate(dataset):
    loss,acc = train_on_batch(tf.reshape(x,(-1,2)), tf.reshape(y,(-1,1)))
  print('Epoch %d: last batch loss = %.4f, acc = %.4f' % (epoch, float(loss),acc))
```

**Task 1**: Plot the graphs of loss function and accuracy on training and validation data during training

**Task 2**: Try to solve MNIST classificiation problem using this code. Hint: use `softmax_crossentropy_with_logits` or `sparse_softmax_cross_entropy_with_logits` as loss function. In the first case you need to feed expected output values in *one hot encoding*, and in the second case - as integer class number.

#### Keras
##### Deep Learning for Humans

* Keras is a library originally developed by Francois Chollet to work on top of Tensorflow, CNTK and Theano, to unify all lower-level frameworks. You can still install Keras as a separate library, but it is not advised to do so. 
* Now Keras is included as part of Tensorflow library
* You can easily construct neural networks from layers
* Contains `fit` function to do all training, plus a lot of functions to work with typical data (pictures, text, etc.)
* A lot of samples
* Functional API vs. Sequential API

Keras provides higher level abstractions for neural networks, allowing us to operate in terms of layers, models and optimizers, and not in terms of tensors and gradients.  

Classical Deep Learning book from the creator of Keras: [Deep Learning with Python](https://www.manning.com/books/deep-learning-with-python)

##### Functional API

When using functional API, we define the **input** to the network as `keras.Input`, and then compute the **output** by passing it through a series of computations. Finally, we define **model** as an object that transforms input into output.

Once we obtained **model** object, we need to:
* **Compile it**, by specifying loss function and the optimizer that we want to use with our model
* **Train it** by calling `fit` function with the training (and possibly validation) data

```python
inputs = tf.keras.Input(shape=(2,))
z = tf.keras.layers.Dense(1,kernel_initializer='glorot_uniform',activation='sigmoid')(inputs)
model = tf.keras.models.Model(inputs,z)

model.compile(tf.keras.optimizers.Adam(0.1),'binary_crossentropy',['accuracy'])
model.summary()
h = model.fit(train_x_norm,train_labels,batch_size=8,epochs=15)
```

```python
plt.plot(h.history['accuracy'])
```

##### Sequential API

Alternatively, we can start thinking of a model as of a **sequence of layers**, and just specify those layers by adding them to the `model` object:

```python
model = tf.keras.models.Sequential()
model.add(tf.keras.layers.Dense(5,activation='sigmoid',input_shape=(2,)))
model.add(tf.keras.layers.Dense(1,activation='sigmoid'))

model.compile(tf.keras.optimizers.Adam(0.1),'binary_crossentropy',['accuracy'])
model.summary()
model.fit(train_x_norm,train_labels,validation_data=(test_x_norm,test_labels),batch_size=8,epochs=15)
```

#### Classification Loss Functions

It is important to correctly specify loss function and activation function on the last layer of the network. The main rules are the following:
* If the network has one output (**binary classification**), we use **sigmoid** activation function, for **multiclass classification** - **softmax**
* If the output class is represented as one-hot-encoding, the loss function will be **cross entropy loss** (categorical cross-entropy), if the output contains class number - **sparse categorical cross-entropy**.  For **binary classification** - use **binary cross-entropy** (same as **log loss**)
* **Multi-label classification** is when we can have an object belonging to several classes at the same time. In this case, we need to encode labels using one-hot encoding, and use **sigmoid** as activation function, so that each class probability is between 0 and 1.

| Classification | Label Format | Activation Function | Loss |
|---------------|-----------------------|-----------------|----------|
| Binary      | Probability of 1st class | sigmoid | binary crossentropy |
| Binary      | One-hot encoding (2 outputs) | softmax | categorical crossentropy |
| Multiclass |  One-hot encoding | softmax | categorical crossentropy |
| Multiclass | Class Number | softmax | sparse categorical crossentropy |
| Multilabel | One-hot encoding | sigmoid | categorical crossentropy |

> Binary classification can also be handled as a special case of multi-class classification with two outputs. In this case, we need to use **softmax**.

**Task 3**: 
Use Keras to train MNIST classifier:
* Notice that Keras contains some standard datasets, including MNIST. To use MNIST from Keras, you only need a couple of lines of code (more information [here](https://www.tensorflow.org/api_docs/python/tf/keras/datasets/mnist))
* Try several network configuration, with different number of layers/neurons, activation functions.

What is the best accuracy you were able to achieve?

#### Takeaways

* Tensorflow allows you to operate on tensors at low level, you have most flexibility.
* There are convenient tools to work with data (`td.Data`) and layers (`tf.layers`)
* For beginners/typical tasks, it is recommended to use **Keras**, which allows to construct networks from layers
* If non-standard architecture is needed, you can implement your own Keras layer, and then use it in Keras models
* It is a good idea to look at PyTorch as well and compare approaches. 

A good sample notebook from the creator of Keras on Keras and Tensorflow 2.0 can be found [here](https://t.co/k694J95PI8).

---

**📓 Notebook 代码**（来自 `lessons/3-NeuralNetworks/05-Frameworks/IntroPyTorch.ipynb`）:

#### Introduction to PyTorch

> This notebook is a part of [AI for Beginners Curricula](http://github.com/microsoft/ai-for-beginners). Visit the repository for complete set of learning materials.

##### Neural Frameworks

We have learnt that to train neural networks you need:
* Quickly multiply matrices (tensors)
* Compute gradients to perform gradient descent optimization

What neural network frameworks allow you to do:
* Operate with tensors on whatever compute is available, CPU or GPU, or even TPU
* Automatically compute gradients (they are explicitly programmed for all built-in tensor functions)

Optionally:
* Neural Network constructor / higher level API (describe network as a sequence of layers)
* Simple training functions (`fit`, as in Scikit Learn)
* A number of optimization algorithms in addition to gradient descent
* Data handling abstractions (that will ideally work on GPU, too)

##### Most Popular Frameworks

* Tensorflow 1.x - first widely available framework (Google). Allowed to define static computation graph, push it to GPU, and explicitly evaluate it
* PyTorch - a framework from Facebook that is growing in popularity
* Keras - higher level API on top of Tensorflow/PyTorch to unify and simplify using neural networks (Francois Chollet)
* Tensorflow 2.x + Keras - new version of Tensorflow with integrated Keras functionality, which supports **dynamic computation graph**, allowing to perform tensor operations very similar to numpy (and PyTorch)

In this Notebook, we will learn to use PyTorch. You need to make sure that you have recent version of PyTorch installed - to do it, follow the [instructions on their site](https://pytorch.org/get-started/locally/). It is normally as simple as doing
```
pip install torch torchvision
```
or
```
conda install pytorch -c pytorch
```

```python
import torch
torch.__version__
```

#### Basic Concepts: Tensor

**Tensor** is a multi-dimensional array. It is very convenient to use tensors to represent different types of data:
* 400x400 - black-and-white picture
* 400x400x3 - color picture 
* 16x400x400x3 - minibatch of 16 color pictures
* 25x400x400x3 - one second of 25-fps video
* 8x25x400x400x3 - minibatch of 8 1-second videos

##### Simple Tensors

You can easily create simple tensors from lists of np-arrays, or generate random ones:

```python
a = torch.tensor([[1,2],[3,4]])
print(a)
a = torch.randn(size=(10,3))
print(a)
```

You can use arithmetic operations on tensors, which are performed element-wise, as in numpy. Tensors are automatically expanded to required dimension, if needed. To extract numpy-array from tensor, use `.numpy()`:

```python
print(a-a[0])
print(torch.exp(a)[0].numpy())
```

#### In-place and out-of-place Operations

Tensor operations such as `+`/`add` return new tensors. However, sometimes you need to modify the existing tensor in-place. Most of the operations have their in-place counterparts, which end with `_`:

```python
u = torch.tensor(5)
print("Result when adding out-of-place:",u.add(torch.tensor(3)))
u.add_(torch.tensor(3))
print("Result after adding in-place:", u)
```

This is how we can compute the sum or all rows in a matrix in a naive way:

```python
s = torch.zeros_like(a[0])
for i in a:
  s.add_(i)

print(s)
```

But it is much better to use

```python
torch.sum(a,axis=0)
```

You can read more on PyTorch tensors in the [official documentation](https://pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html)

#### Computing Gradients

For back propagation, you need to compute gradients. We can set any PyTorch Tensor's attribute `requires_grad` to `True`, which will result in all operations with this tensor being tracked for gradient calculations. To compute the gradients, you need to call `backward()` method, after which the gradient will become available using `grad` attribute:

```python
a = torch.randn(size=(2, 2), requires_grad=True)
b = torch.randn(size=(2, 2))

c = torch.mean(torch.sqrt(torch.square(a) + torch.square(b)))  # Do some math using `a`
c.backward() # call backward() to compute all gradients
# What's the gradient of `c` with respect to `a`?
print(a.grad)
```

To be more precise, PyTorch automatically **accumulates** gradients. If you specify `retain_graph=True` when calling `backward`, computational graph will be preserved, and new gradient is added to the `grad` field. In order to restart computing gradients from scratch, we need to reset `grad` field to 0 explicitly by calling `zero_()`:  

```python
c = torch.mean(torch.sqrt(torch.square(a) + torch.square(b)))
c.backward(retain_graph=True)
c.backward(retain_graph=True)
print(a.grad)
a.grad.zero_()
c.backward()
print(a.grad)
```

To compute gradients, PyTorch creates and maintains **compute graph**. For each tensor that has the `requires_grad` flag set to `True`, PyTorch maintains a special function called `grad_fn`, which computes the derivative of the expression according to chain differentiation rule:

```python
print(c)
```

Here `c` is computed using `mean` function, thus `grad_fn` point to a function called `MeanBackward`.

In most of the cases, we want PyTorch to compute gradient of a scalar function (such as loss function). However, if we want to compute the gradient of a tensor with respect to another tensor, PyTorch allows us to compute the product of a Jacobian matrix and a given vector.

Suppose we have a vector function $\vec{y}=f(\vec{x})$, where
$\vec{x}=\langle x_1,\dots,x_n\rangle$ and
$\vec{y}=\langle y_1,\dots,y_m\rangle$, then a gradient of $\vec{y}$ with respect to $\vec{x}$ is defined by a **Jacobian**:

$$
\begin{align}J=\left(\begin{array}{ccc}
   \frac{\partial y_{1}}{\partial x_{1}} & \cdots & \frac{\partial y_{1}}{\partial x_{n}}\\
   \vdots & \ddots & \vdots\\
   \frac{\partial y_{m}}{\partial x_{1}} & \cdots & \frac{\partial y_{m}}{\partial x_{n}}
\end{array}\right)\end{align}
$$

Instead of giving us access to the whole Jacobian, PyTorch computes the product $v^T\cdot J$ of Jacobian with some vector
$v=(v_1 \dots v_m)$. In order to do that, we need to call ``backward`` and pass `v` as an argument. The size of `v` should be the same as the size of the original tensor, with respect to which we compute the gradient.

```python
c = torch.sqrt(torch.square(a) + torch.square(b))
c.backward(torch.eye(2)) # eye(2) means 2x2 identity matrix
print(a.grad)
```

More on computing Jacobians in PyTorch can be found in [official documentation](https://pytorch.org/tutorials/beginner/basics/autogradqs_tutorial.html)

Let's try to use automatic differentiation to find a minimum of a simple two-variable function $f(x_1,x_2)=(x_1-3)^2+(x_2+2)^2$. Let tensor `x` hold the current coordinates of a point. We start with some starting point $x^{(0)}=(0,0)$, and compute the next point in a sequence using gradient descent formula:
$$
x^{(n+1)} = x^{(n)} - \eta\nabla f
$$
Here $\eta$ is so-called **learning rage** (we will denote it by `lr` in the code), and $\nabla f = (\frac{\partial f}{\partial x_1},\frac{\partial f}{\partial x_2})$ - gradient of $f$.

To begin, let's define starting value of `x` and the function `f`:

```python
x = torch.zeros(2,requires_grad=True)
f = lambda x : (x-torch.tensor([3,-2])).pow(2).sum()
lr = 0.1
```

Now let's do 15 iterations of gradient descent. In each iteration, we will update `x` coordinates and print them, to make sure that we are approaching the minimum point at (3,-2):

```python
for i in range(15):
    y = f(x)
    y.backward()
    gr = x.grad
    x.data.add_(-lr*gr)
    x.grad.zero_()
    print("Step {}: x[0]={}, x[1]={}".format(i,x[0],x[1]))
```

#### Example 1: Linear Regression

Now we know enough to solve the classical problem of **Linear regression**. Let's generate small synthetic dataset:

```python
import numpy as np
import matplotlib.pyplot as plt
from sklearn.datasets import make_classification, make_regression
from sklearn.model_selection import train_test_split
import random
```

```python
np.random.seed(13) # pick the seed for reproducibility - change it to explore the effects of random variations

train_x = np.linspace(0, 3, 120)
train_labels = 2 * train_x + 0.9 + np.random.randn(*train_x.shape) * 0.5

plt.scatter(train_x,train_labels)
```

Linear regression is defined by a straight line $f_{W,b}(x) = Wx+b$, where $W, b$ are model parameters that we need to find. An error on our dataset $\{x_i,y_u\}_{i=1}^N$ (also called **loss function**) can be defined as mean square error:
$$
\mathcal{L}(W,b) = {1\over N}\sum_{i=1}^N (f_{W,b}(x_i)-y_i)^2
$$

Let's define our model and loss function:

```python
input_dim = 1
output_dim = 1
learning_rate = 0.1

# This is our weight matrix
w = torch.tensor([100.0],requires_grad=True,dtype=torch.float32)
# This is our bias vector
b = torch.zeros(size=(output_dim,),requires_grad=True)

def f(x):
  return torch.matmul(x,w) + b

def compute_loss(labels, predictions):
  return torch.mean(torch.square(labels - predictions))
```

We will train the model on a series of minibatches. We will use gradient descent, adjusting model parameters using the following formulae:
$$
\begin{array}{l}
W^{(n+1)}=W^{(n)}-\eta\frac{\partial\mathcal{L}}{\partial W} \\
b^{(n+1)}=b^{(n)}-\eta\frac{\partial\mathcal{L}}{\partial b} \\
\end{array}
$$

```python
def train_on_batch(x, y):
  predictions = f(x)
  loss = compute_loss(y, predictions)
  loss.backward()
  w.data.sub_(learning_rate * w.grad)
  b.data.sub_(learning_rate * b.grad)
  w.grad.zero_()
  b.grad.zero_()
  return loss
```

Let's do the training. We will do several passes through the dataset (so-called **epochs**), divide it into minibatches and call the function defined above:

```python
# Shuffle the data.
indices = np.random.permutation(len(train_x))
features = torch.tensor(train_x[indices],dtype=torch.float32)
labels = torch.tensor(train_labels[indices],dtype=torch.float32)
```

```python
batch_size = 4
for epoch in range(10):
  for i in range(0,len(features),batch_size):
    loss = train_on_batch(features[i:i+batch_size].view(-1,1),labels[i:i+batch_size])
  print('Epoch %d: last batch loss = %.4f' % (epoch, float(loss)))
```

We now have obtained optimized parameters $W$ and $b$. Note that their values are similar to the original values used when generating the dataset ($W=2, b=1$)

```python
w,b
```

```python
plt.scatter(train_x,train_labels)
x = np.array([min(train_x),max(train_x)])
with torch.no_grad():
  y = w.numpy()*x+b.numpy()
plt.plot(x,y,color='red')
```

#### Computations on GPU

To use GPU for computations, PyTorch supports moving tensors to GPU and building computational graph for GPU. Traditionally, in the beginning of our code we define available computation device `device` (which is either `cpu` or `cuda`), and then move all tensors to this device using a call `.to(device)`. We can also create tensors on the specified device upfront, by passing the parameter `device=...` to tensor creation code. Such code works without changes both on CPU and GPU: 

```python
device = 'cuda' if torch.cuda.is_available() else 'cpu'

print('Doing computations on '+device)

### Changes here: indicate device
w = torch.tensor([100.0],requires_grad=True,dtype=torch.float32,device=device)
b = torch.zeros(size=(output_dim,),requires_grad=True,device=device)

def f(x):
  return torch.matmul(x,w) + b

def compute_loss(labels, predictions):
  return torch.mean(torch.square(labels - predictions))

def train_on_batch(x, y):
  predictions = f(x)
  loss = compute_loss(y, predictions)
  loss.backward()
  w.data.sub_(learning_rate * w.grad)
  b.data.sub_(learning_rate * b.grad)
  w.grad.zero_()
  b.grad.zero_()
  return loss

batch_size = 4
for epoch in range(10):
  for i in range(0,len(features),batch_size):
    ### Changes here: move data to required device
    loss = train_on_batch(features[i:i+batch_size].view(-1,1).to(device),labels[i:i+batch_size].to(device))
  print('Epoch %d: last batch loss = %.4f' % (epoch, float(loss)))
```

#### Example 2: Classification

Now we will consider binary classification problem. A good example of such a problem would be a tumour classification between malignant and benign based on it's size and age.

The core model is similar to regression, but we need to use different loss function. Let's start by generating sample data:

```python
np.random.seed(0) # pick the seed for reproducibility - change it to explore the effects of random variations

n = 100
X, Y = make_classification(n_samples = n, n_features=2,
                           n_redundant=0, n_informative=2, flip_y=0.1,class_sep=1.5)
X = X.astype(np.float32)
Y = Y.astype(np.int32)

split = [ 70*n//100, (15+70)*n//100 ]
train_x, valid_x, test_x = np.split(X, split)
train_labels, valid_labels, test_labels = np.split(Y, split)
```

```python
def plot_dataset(features, labels, W=None, b=None):
    # prepare the plot
    fig, ax = plt.subplots(1, 1)
    ax.set_xlabel('$x_i[0]$ -- (feature 1)')
    ax.set_ylabel('$x_i[1]$ -- (feature 2)')
    colors = ['r' if l else 'b' for l in labels]
    ax.scatter(features[:, 0], features[:, 1], marker='o', c=colors, s=100, alpha = 0.5)
    if W is not None:
        min_x = min(features[:,0])
        max_x = max(features[:,1])
        min_y = min(features[:,1])*(1-.1)
        max_y = max(features[:,1])*(1+.1)
        cx = np.array([min_x,max_x],dtype=np.float32)
        cy = (0.5-W[0]*cx-b)/W[1]
        ax.plot(cx,cy,'g')
        ax.set_ylim(min_y,max_y)
    fig.show()
```

```python
plot_dataset(train_x, train_labels)
```

#### Training One-Layer Perceptron

Let's use PyTorch gradient computing machinery to train one-layer perceptron.

Our neural network will have 2 inputs and 1 output. The weight matrix $W$ will have size $2\times1$, and bias vector $b$ -- $1$.

To make our code more structured, let's group all parameters into a single class:

```python
class Network():
  def __init__(self):
     self.W = torch.randn(size=(2,1),requires_grad=True)
     self.b = torch.zeros(size=(1,),requires_grad=True)

  def forward(self,x):
    return torch.matmul(x,self.W)+self.b

  def zero_grad(self):
    self.W.data.zero_()
    self.b.data.zero_()

  def update(self,lr=0.1):
    self.W.data.sub_(lr*self.W.grad)
    self.b.data.sub_(lr*self.b)

net = Network()
```

> Note that we use `W.data.zero_()` instead of `W.zero_()`. We need to do this, because we cannot directly modify a tensor that is being tracked using *Autograd* mechanism.

Core model will be the same as in previous example, but loss function will be a logistic loss. To apply logistic loss, we need to get the value of **probability** as the output of our network, i.e. we need to bring the output $z$ to the range [0,1] using `sigmoid` activation function: $p=\sigma(z)$.

If we get the probability $p_i$ for the i-th input value corresponding to the actual class $y_i\in\{0,1\}$, we compute the loss as $\mathcal{L_i}=-(y_i\log p_i + (1-y_i)log(1-p_i))$. 

In PyTorch, both those steps (applying sigmoid and then logistic loss) can be done using one call to `binary_cross_entropy_with_logits` function. Since we are training our network in minibatches, we need to average out the loss across all elements of a minibatch - and that is also done automatically by `binary_cross_entropy_with_logits` function: 

> The call to `binary_crossentropy_with_logits` is equivalent to a call to `sigmoid`, followed by a call to `binary_crossentropy`

```python
def train_on_batch(net, x, y):
  z = net.forward(x).flatten()
  loss = torch.nn.functional.binary_cross_entropy_with_logits(input=z,target=y)
  net.zero_grad()
  loss.backward()
  net.update()
  return loss
```

To loop through our data, we will use built-in PyTorch mechanism for managing datasets. It is based on two concepts:
* **Dataset** is the main source of data, it can be either **Iterable** or **Map-style**
* **Dataloader** is responsible for loading the data from a dataset and splitting it into minibatches.

In our case, we will define a dataset based on a tensor, and split it into minibatches of 16 elements. Each minibatch contains two tensors, input data (size=16x2) and labels (a vector of length 16 of integer type - class number).

```python
# Create a tf.data.Dataset object for easy batched iteration
dataset = torch.utils.data.TensorDataset(torch.tensor(train_x),torch.tensor(train_labels,dtype=torch.float32))
dataloader = torch.utils.data.DataLoader(dataset,batch_size=16)

list(dataloader)[0]
```

Now we can loop through the whole dataset to train our network for 15 epochs:

```python
for epoch in range(15):
  for (x, y) in dataloader:
    loss = train_on_batch(net,x,y)
  print('Epoch %d: last batch loss = %.4f' % (epoch, float(loss)))
```

Obtained parameters:

```python
print(net.W,net.b)
```

To make sure our training worked, let's plot the line that separates two classes. Separation line is defined by the equation $W\times x + b = 0.5$

```python
plot_dataset(train_x,train_labels,net.W.detach().numpy(),net.b.detach().numpy())
```

Not let's compute the accuracy on the validation dataset:

```python
pred = torch.sigmoid(net.forward(torch.tensor(valid_x)))
torch.mean(((pred.view(-1)>0.5)==(torch.tensor(valid_labels)>0.5)).type(torch.float32))
```

Let's explain what is going on here:
* `pred` is the vector of predicted probabilities for the whole validation dataset. We compute it by running original validation data `valid_x` through our network, and applying `sigmoid` to get probabilities.
* `pred.view(-1)` creates a flattened view of the original tensor. `view` is similar to `reshape` function in numpy.
* `pred.view(-1)>0.5` returns a boolean tensor or truth value showing the predicted class (False = class 0, True = class 1)
* Similarly, `torch.tensor(valid_labels)>0.5)` creates the boolean tensor of truth values for validation labels
* We compare those two tensors element-wise, and get another boolean tensor, where `True` corresponds to correct prediction, and `False` - to incorrect.
* We convert that tensor to floating point, and take it's mean value using `torch.mean` - that is the desired accuracy 

#### Neural Networks and Optimizers

In PyTorch, a special module `torch.nn.Module` is defined to represent a neural network. There are two methods to define your own neural network:
* **Sequential**, where you just specify a list of layers that comprise your network
* As a **class** inherited from `torch.nn.Module`

First method allows you to specify standard networks with sequential composition of layers, while the second one is more flexible, and gives an opportunity to express networks of arbitrary complex architectures. 

Inside modules, you can use standard **layers**, such as:
* `Linear` - dense linear layer, equivalent to one-layered perceptron. It has the same architecture as we have defined above for our network
* `Softmax`, `Sigmoid`, `ReLU` - layers that correspond to activation functions 
* There are also other layers for special network types - convolution, recurrent, etc. We will revisit many of them later in the course.

> Most of the activation function and loss functions in PyTorch are available in two form: as a **function** (inside `torch.nn.functional` namespace) and **as a layer** (inside `torch.nn` namespace). For activation functions, it is often easier to use functional elements from `torch.nn.functional`, without creating separate layer object.

If we want to train one-layer perceptron, we can just use one built-in `Linear` layer:

```python
net = torch.nn.Linear(2,1) # 2 inputs, 1 output

print(list(net.parameters()))
```

As you can see, `parameters()` method returns all the parameters that need to be adjusted during training. They correspond to weight matrix $W$ and bias $b$. You may note that they have `requires_grad` set to `True`, because we need to compute gradients with respect to parameters.

PyTorch also contains built-in **optimizers**, which implement optimization methods such as **gradient descent**. Here is how we can define a **stochastic gradient descent optimizer**:

```python
optim = torch.optim.SGD(net.parameters(),lr=0.05)
```

Using the optimizer, our training loop will look like this:

```python
val_x = torch.tensor(valid_x)
val_lab = torch.tensor(valid_labels)

for ep in range(10):
  for (x,y) in dataloader:
    z = net(x).flatten()
    loss = torch.nn.functional.binary_cross_entropy_with_logits(z,y)
    optim.zero_grad()
    loss.backward()
    optim.step()
  acc = ((torch.sigmoid(net(val_x).flatten())>0.5).float()==val_lab).float().mean()
  print(f"Epoch {ep}: last batch loss = {loss}, val acc = {acc}")
```

> You may notice that to apply our network to input data we can use `net(x)` instead of `net.forward(x)`, because `nn.Module` implements Python `__call__()` function

Taking this into account, we can define generic `train` function:

```python
def train(net, dataloader, val_x, val_lab, epochs=10, lr=0.05):
  optim = torch.optim.Adam(net.parameters(),lr=lr)
  for ep in range(epochs):
    for (x,y) in dataloader:
      z = net(x).flatten()
      loss = torch.nn.functional.binary_cross_entropy_with_logits(z,y)
      optim.zero_grad()
      loss.backward()
      optim.step()
    acc = ((torch.sigmoid(net(val_x).flatten())>0.5).float()==val_lab).float().mean()
    print(f"Epoch {ep}: last batch loss = {loss}, val acc = {acc}")

net = torch.nn.Linear(2,1)

train(net,dataloader,val_x,val_lab,lr=0.03)
```

#### Defining Network as a Sequence of Layers

Now let's train multi-layered perceptron. It can be defined just by specifying a sequence of layers. The resulting object will automatically inherit from `Module`, e.g. it will also have `parameters` method that will return all parameters of the whole network.

```python
net = torch.nn.Sequential(torch.nn.Linear(2,5),torch.nn.Sigmoid(),torch.nn.Linear(5,1))
print(net)
```

We can train this multi-layered network using the function `train` that we have defined above:

```python
train(net,dataloader,val_x,val_lab)
```

#### Defining a Network as a Class

Using a class inherited from `torch.nn.Module` is a more flexible method, because we can define any computations inside it. `Module` automates a lot of things, eg. it automatically understands all internal variables that are PyTorch layers, and gathers their parameters for optimization. You just need to define all layers of the network as members of the class:

```python
class MyNet(torch.nn.Module):
  def __init__(self,hidden_size=10,func=torch.nn.Sigmoid()):
    super().__init__()
    self.fc1 = torch.nn.Linear(2,hidden_size)
    self.func = func
    self.fc2 = torch.nn.Linear(hidden_size,1)

  def forward(self,x):
    x = self.fc1(x)
    x = self.func(x)
    x = self.fc2(x)
    return x
  
net = MyNet(func=torch.nn.ReLU())
print(net)
```

```python
train(net,dataloader,val_x,val_lab,lr=0.005)
```

**Task 1**: Plot the graphs of loss function and accuracy on training and validation data during training

**Task 2**: Try to solve MNIST classificiation problem using this code. Hint: use `crossentropy_with_logits` as a loss function.

#### Defining a Network as PyTorch Lightning Module

Let's wrap the written PyTorch model code in PyTorch Lightining module. This allows to work with your model more conveniently and flexibly using various Lightining methods for training and accuracy testing.

First we need to install and import PyTorch Lightining. This can be done with the command

```
pip install pytorch-lightning
```
or
```
conda install -c conda-forge pytorch-lightning
```

```python
import pytorch_lightning as pl
```

In order for our code to work in Lightning, we need to do the following:

1. Create a subclass of `pl.LightningModule` and add to it model architecture in `__init__` method and `forward` pass method.
2. Move used optimizer to the `configure_optimizers()` method.
3. Define the training and validation process in methods `training_step` and `validation_step` respectively.
4. (Optional) Implement a testing (`test_step` method) and prediction process (`predict_step` method).

It should also be understood that PyTorch Lightning has a built-in translation of models to different devices, depending on where the incoming data from the `DataLoaders` is located. Therefore, all calls `.cuda()` or `.to(device)` should be removed from the code.

```python
class MyNetPL(pl.LightningModule):
    def __init__(self, hidden_size = 10, func = torch.nn.Sigmoid()):
        super().__init__()
        self.fc1 = torch.nn.Linear(2,hidden_size)
        self.func = func
        self.fc2 = torch.nn.Linear(hidden_size,1)

        self.val_epoch_num = 0 # for logging

    def forward(self, x):
        x = self.fc1(x)
        x = self.func(x)
        x = self.fc2(x)
        return x

    def training_step(self, batch, batch_nb):
        x, y = batch
        y_res = self(x).view(-1)
        loss = torch.nn.functional.binary_cross_entropy_with_logits(y_res, y)
        return loss

    def configure_optimizers(self):
        optimizer = torch.optim.SGD(self.parameters(), lr = 0.005)
        return optimizer
    
    def validation_step(self, batch, batch_nb):
        x, y = batch
        y_res = self(x).view(-1)
        val_loss = torch.nn.functional.binary_cross_entropy_with_logits(y_res, y)
        print("Epoch ", self.val_epoch_num, ": val loss = ", val_loss.item(), " val acc = ",((torch.sigmoid(y_res.flatten())>0.5).float()==y).float().mean().item(),  sep = "")
        self.val_epoch_num += 1
```

Let's also add validation `Dataset` and `DataLoader`:

```python
valid_dataset = torch.utils.data.TensorDataset(torch.tensor(valid_x),torch.tensor(valid_labels,dtype=torch.float32))
valid_dataloader = torch.utils.data.DataLoader(valid_dataset, batch_size = 16)
```

Now our model is ready for training. In Pytorch Lightning, this process is implemented through an object of the `Trainer` class, which essentially "mixes" the model with any datasets.

```python
net = MyNetPL(func=torch.nn.ReLU())
trainer = pl.Trainer(max_epochs = 30, log_every_n_steps = 1, accelerator='gpu', devices=1)
trainer.fit(model = net, train_dataloaders = dataloader, val_dataloaders = valid_dataloader)
```

#### Takeaways

* PyTorch allows you to operate on tensors at low level, you have most flexibility.
* There are convenient tools to work with data, such as Datasets and Dataloaders.
* You can define neural network architectures using `Sequential` syntax, or inheriting a class from `torch.nn.Module`
* For even simpler approach to defining and training a network - look into PyTorch Lightning

---

**🔧 练习**（来自 `lessons/3-NeuralNetworks/05-Frameworks/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

Solve two classification problems using single and multi-layered fully-connected networks using PyTorch or TensorFlow:

1. **[Iris classification](https://en.wikipedia.org/wiki/Iris_flower_data_set)** problem - an example of problem with tabular input data, which can be handled by classical machine learning. You goal would be to classify irises into 3 classes, based on 4 numeric parameters.
1. **MNIST** handwritten digit classification problem which we have seen before.

Try different network architectures to achieve the best accuracy you can get.

#### Stating Notebook

Start the lab by opening [LabFrameworks.ipynb](LabFrameworks.ipynb)

### Neural Network Frameworks

As we have learned already, to be able to train neural networks efficiently we need to do two things:

* To operate on tensors, eg. to multiply, add, and compute some functions such as sigmoid or softmax
* To compute gradients of all expressions, in order to perform gradient descent optimization

While the `numpy` library can do the first part, we need some mechanism to compute gradients. In [our framework](../04-OwnFramework/OwnFramework.ipynb) that we have developed in the previous section we had to manually program all derivative functions inside the `backward` method, which does backpropagation. Ideally, a framework should give us the opportunity to compute gradients of *any expression* that we can define.

Another important thing is to be able to perform computations on GPU, or any other specialized compute units, such as [TPU](https://en.wikipedia.org/wiki/Tensor_Processing_Unit). Deep neural network training requires *a lot* of computations, and to be able to parallelize those computations on GPUs is very important.

> ✅ The term 'parallelize' means to distribute the computations over multiple devices.

Currently, the two most popular neural frameworks are: [TensorFlow](http://TensorFlow.org) and [PyTorch](https://pytorch.org/). Both provide a low-level API to operate with tensors on both CPU and GPU. On top of the low-level API, there is also higher-level API, called [Keras](https://keras.io/) and [PyTorch Lightning](https://pytorchlightning.ai/) correspondingly.

Low-Level API | [TensorFlow](http://TensorFlow.org) | [PyTorch](https://pytorch.org/)
--------------|-------------------------------------|--------------------------------
High-level API| [Keras](https://keras.io/) | [PyTorch Lightning](https://pytorchlightning.ai/)

**Low-level APIs** in both frameworks allow you to build so-called **computational graphs**. This graph defines how to compute the output (usually the loss function) with given input parameters, and can be pushed for computation on GPU, if it is available. There are functions to differentiate this computational graph and compute gradients, which can then be used for optimizing model parameters.

**High-level APIs** pretty much consider neural networks as a **sequence of layers**, and make constructing most of the neural networks much easier. Training the model usually requires preparing the data and then calling a `fit` function to do the job.

The high-level API allows you to construct typical neural networks very quickly without worrying about lots of details. At the same time, low-level API offer much more control over the training process, and thus they are used a lot in research, when you are dealing with new neural network architectures.

It is also important to understand that you can use both APIs together, eg. you can develop your own network layer architecture using low-level API, and then use it inside the larger network constructed and trained with the high-level API. Or you can define a network using the high-level API as a sequence of layers, and then use your own low-level training loop to perform optimization. Both APIs use the same basic underlying concepts, and they are designed to work well together.

#### Learning

In this course, we offer most of the content both for PyTorch and TensorFlow. You can choose your preferred framework and only go through the corresponding notebooks. If you are not sure which framework to choose, read some discussions on the internet regarding **PyTorch vs. TensorFlow**. You can also have a look at both frameworks to get better understanding.

Where possible, we will use High-Level APIs for simplicity. However, we believe it is important to understand how neural networks work from the ground up, thus in the beginning we start by working with low-level API and tensors. However, if you want to get going fast and do not want to spend a lot of time on learning these details, you can skip those and go straight into high-level API notebooks.

#### ✍️ Exercises: Frameworks

Continue your learning in the following notebooks:

Low-Level API | [TensorFlow+Keras Notebook](IntroKerasTF.ipynb) | [PyTorch](IntroPyTorch.ipynb)
--------------|-------------------------------------|--------------------------------
High-level API| [Keras](IntroKeras.ipynb) | *PyTorch Lightning*

After mastering the frameworks, let's recap the notion of overfitting.

Overfitting is an extremely important concept in machine learning, and it is very important to get it right!

Consider the following problem of approximating 5 dots (represented by `x` on the graphs below):

![linear](../images/overfit1.jpg) | ![overfit](../images/overfit2.jpg)
-------------------------|--------------------------
**Linear model, 2 parameters** | **Non-linear model, 7 parameters**
Training error = 5.3 | Training error = 0
Validation error = 5.1 | Validation error = 20

* On the left, we see a good straight line approximation. Because the number of parameters is adequate, the model gets the idea behind point distribution right.
* On the right, the model is too powerful. Because we only have 5 points and the model has 7 parameters, it can adjust in such a way as to pass through all points, making training the error to be 0. However, this prevents the model from understanding the correct pattern behind data, thus the validation error is very high.

It is very important to strike a correct balance between the richness of the model (number of parameters) and the number of training samples.

#### Why overfitting occurs

  * Not enough training data
  * Too powerful model
  * Too much noise in input data

#### How to detect overfitting

As you can see from the graph above, overfitting can be detected by a very low training error, and a high validation error. Normally during training we will see both training and validation errors starting to decrease, and then at some point validation error might stop decreasing and start rising. This will be a sign of overfitting, and the indicator that we should probably stop training at this point (or at least make a snapshot of the model).

![overfitting](../images/Overfitting.png)

#### How to prevent overfitting

If you can see that overfitting occurs, you can do one of the following:

 * Increase the amount of training data
 * Decrease the complexity of the model
 * Use some [regularization technique](../../4-ComputerVision/08-TransferLearning/TrainingTricks.md), such as [Dropout](../../4-ComputerVision/08-TransferLearning/TrainingTricks.md#Dropout), which we will consider later.

#### Overfitting and Bias-Variance Tradeoff

Overfitting is actually a case of a more generic problem in statistics called [Bias-Variance Tradeoff](https://en.wikipedia.org/wiki/Bias%E2%80%93variance_tradeoff). If we consider the possible sources of error in our model, we can see two types of errors:

* **Bias errors** are caused by our algorithm not being able to capture the relationship between training data correctly. It can result from the fact that our model is not powerful enough (**underfitting**).
* **Variance errors**, which are caused by the model approximating noise in the input data instead of meaningful relationship (**overfitting**).

During training, bias error decreases (as our model learns to approximate the data), and variance error increases. It is important to stop training - either manually (when we detect overfitting) or automatically (by introducing regularization) - to prevent overfitting.

#### Conclusion

In this lesson, you learned about the differences between the various APIs for the two most popular AI frameworks, TensorFlow and PyTorch. In addition, you learned about a very important topic, overfitting.

#### 🚀 Challenge

In the accompanying notebooks, you will find 'tasks' at the bottom; work through the notebooks and complete the tasks.

#### Review & Self Study

Do some research on the following topics:

- TensorFlow
- PyTorch
- Overfitting

Ask yourself the following questions:

- What is the difference between TensorFlow and PyTorch?
- What is the difference between overfitting and underfitting?

## Computer Vision

### Loading Images

> **📖 章节概述**
>
> # Computer Vision
> 
> ![Summary of Computer Vision content in a doodle](../sketchnotes/ai-computervision.png)
> 
> In this section we will learn about:
> 
> * [Intro to Computer Vision and OpenCV](06-IntroCV/README.md)
> * [Convolutional Neural Networks](07-ConvNets/README.md)
> * [Pre-trained Networks and Transfer Learning](08-TransferLearning/README.md) 
> * [Autoencoders](09-Autoencoders/README.md)
> * [Generative Adversarial Networks](10-GANs/README.md)
> * [Object Detection](11-ObjectDetection/README.md)
> * [Semantic Segmentation](12-Segmentation/README.md)

---

Images in Python can be conveniently represented by NumPy arrays. For example, grayscale images with the size of 320x200 pixels would be stored in a 200x320 array, and color images of the same dimension would have shape of 200x320x3 (for 3 color channels). To load an image, you can use the following code:

```python
import cv2
import matplotlib.pyplot as plt

im = cv2.imread('image.jpeg')
plt.imshow(im)
```

Traditionally, OpenCV uses BGR (Blue-Green-Red) encoding for color images, while the rest of Python tools use the more traditional RGB (Red-Green-Blue). For the image to look right, you need to convert it to the RGB color space, either by swapping dimensions in the NumPy array, or by calling an OpenCV function:

```python
im = cv2.cvtColor(im,cv2.COLOR_BGR2RGB)
```

The same `cvtColor` function can be used to perform other color space transformations such as converting an image to grayscale or to the HSV (Hue-Saturation-Value) color space.

You can also use OpenCV to load video frame-by-frame - an example is given in the exercise [OpenCV Notebook](OpenCV.ipynb).

### Image Processing

Before feeding an image to a neural network, you may want to apply several pre-processing steps. OpenCV can do many things, including:

* **Resizing** the image using `im = cv2.resize(im, (320,200),interpolation=cv2.INTER_LANCZOS)`
* **Blurring** the image using `im = cv2.medianBlur(im,3)` or `im = cv2.GaussianBlur(im, (3,3), 0)`
* Changing the **brightness and contrast** of the image can be done by NumPy array manipulations, as described [in this Stackoverflow note](https://stackoverflow.com/questions/39308030/how-do-i-increase-the-contrast-of-an-image-in-python-opencv).
* Using [thresholding](https://docs.opencv.org/4.x/d7/d4d/tutorial_py_thresholding.html) by calling `cv2.threshold`/`cv2.adaptiveThreshold` functions, which is often preferable to adjusting brightness or contrast.
* Applying different [transformations](https://docs.opencv.org/4.5.5/da/d6e/tutorial_py_geometric_transformations.html) to the image:
    - **[Affine transformations](https://docs.opencv.org/4.5.5/d4/d61/tutorial_warp_affine.html)** can be useful if you need to combine rotation, resizing and skewing to the image and you know the source and destination location of three points in the image. Affine transformations keep parallel lines parallel.
    - **[Perspective transformations](https://medium.com/analytics-vidhya/opencv-perspective-transformation-9edffefb2143)** can be useful when you know the source and destination positions of 4 points in the image. For example, if you take a picture of a rectangular document via a smartphone camera from some angle, and you want to make a rectangular image of the document itself.
* Understanding movement inside the image by using **[optical flow](https://docs.opencv.org/4.5.5/d4/dee/tutorial_optical_flow.html)**.

### VGG-16

VGG-16 is a network that achieved 92.7% accuracy in ImageNet top-5 classification in 2014. It has the following layer structure:

![ImageNet Layers](images/vgg-16-arch1.jpg)

As you can see, VGG follows a traditional pyramid architecture, which is a sequence of convolution-pooling layers.

![ImageNet Pyramid](images/vgg-16-arch.jpg)

> Image from [Researchgate](https://www.researchgate.net/figure/Vgg16-model-structure-To-get-the-VGG-NIN-model-we-replace-the-2-nd-4-th-6-th-7-th_fig2_335194493)

### ResNet

ResNet is a family of models proposed by Microsoft Research in 2015. The main idea of ResNet is to use **residual blocks**:

<img src="images/resnet-block.png" width="300"/>

> Image from [this paper](https://arxiv.org/pdf/1512.03385.pdf)

The reason for using identity pass-through is to have our layer predict **the difference** between the result of a previous layer and the output of the residual block - hence the name *residual*. Those blocks are much easier to train, and one can construct networks with several hundreds of those blocks (most common variants are ResNet-52, ResNet-101 and ResNet-152).

You can also think of this network as being able to adjust its complexity to the dataset. Initially, when you are starting to train the network, the weights values are small, and most of the signal goes through passthrough identity layers. As training progresses and weights become larger, the significance of network parameters grow, and the networks adjusts to accommodate required expressive power to correctly classify training images.

### Google Inception

Google Inception architecture takes this idea one step further, and builds each network layer as a combination of several different paths:

<img src="images/inception.png" width="400"/>

> Image from [Researchgate](https://www.researchgate.net/figure/Inception-module-with-dimension-reductions-left-and-schema-for-Inception-ResNet-v1_fig2_355547454)

Here, we need to emphasize the role of 1x1 convolutions, because at first they do not make sense. Why would we need to run through the image with 1x1 filter? However, you need to remember that convolution filters also work with several depth channels (originally - RGB colors, in subsequent layers - channels for different filters), and 1x1 convolution is used to mix those input channels together using different trainable weights. It can be also viewed as downsampling (pooling) over channel dimension.

Here is [a good blog post](https://medium.com/analytics-vidhya/talented-mr-1x1-comprehensive-look-at-1x1-convolution-in-deep-learning-f6b355825578) on the subject, and [the original paper](https://arxiv.org/pdf/1312.4400.pdf).

### MobileNet

MobileNet is a family of models with reduced size, suitable for mobile devices. Use them if you are short in resources, and can sacrifice a little bit of accuracy. The main idea behind them is so-called **depthwise separable convolution**, which allows representing convolution filters by a composition of spatial convolutions and 1x1 convolution over depth channels. This significantly reduces the number of parameters, making the network smaller in size, and also easier to train with less data.

Here is [a good blog post on MobileNet](https://medium.com/analytics-vidhya/image-classification-with-mobilenet-cc6fbb2cd470).

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/07-ConvNets/ConvNetsPyTorch.ipynb`）:

In the previous unit we have learned how to define a multi-layered neural network using class definition, but those networks were generic, and not specialized for computer vision tasks. In this unit we will learn about **Convolutional Neural Networks (CNNs)**, which are specifically designed for computer vision.

Computer vision is different from generic classification, because when we are trying to find a certain object in the picture, we are scanning the image looking for some specific **patterns** and their combinations. For example, when looking for a cat, we first may look for horizontal lines, which can form whiskers, and then certain combination of whiskers can tell us that it is actually a picture of a cat. Relative position and presence of certain patterns is important, and not their exact position on the image. 

To extract patterns, we will use the notion of **convolutional filters**. But first, let us load all dependencies and functions that we have defined in the previous units.

```python
import torch
import torch.nn as nn
import torchvision
import matplotlib.pyplot as plt
from torchinfo import summary
import numpy as np

from pytorchcv import load_mnist, train, plot_results, plot_convolution, display_dataset
load_mnist(batch_size=128)
```

#### Convolutional filters

Convolutional filters are small windows that run over each pixel of the image and compute weighted average of the neighboring pixels.

They are defined by matrices of weight coefficients. Let's see the examples of applying two different convolutional filters over our MNIST handwritten digits:

```python
plot_convolution(torch.tensor([[-1.,0.,1.],[-1.,0.,1.],[-1.,0.,1.]]),'Vertical edge filter')
plot_convolution(torch.tensor([[-1.,-1.,-1.],[0.,0.,0.],[1.,1.,1.]]),'Horizontal edge filter')

```

First filter is called a **vertical edge filter**, and it is defined by the following matrix:
$$
\left(
    \begin{matrix}
     -1 & 0 & 1 \cr
     -1 & 0 & 1 \cr
     -1 & 0 & 1 \cr
    \end{matrix}
\right)
$$
When this filter goes over relatively uniform pixel field, all values add up to 0. However, when it encounters a vertical edge in the image, high spike value is generated. That's why in the images above you can see vertical edges represented by high and low values, while horizontal edges are averaged out.

An opposite thing happens when we apply horizontal edge filter - horizontal lines are amplified, and vertical are averaged out.

In classical computer vision, multiple filters were applied to the image to generate features, which then were used by machine learning algorithm to build a classifier. However, in deep learning we construct networks that **learn** best convolutional filters to solve classification problem.

To do that, we introduce **convolutional layers**.

#### Covolutional layers

Convolutional layers are defined using `nn.Conv2d` construction. We need to specify the following:
* `in_channels` - number of input channels. In our case we are dealing with a grayscale image, thus number of input channels is 1.
* `out_channels` - number of filters to use. We will use 9 different filters, which will give the network plenty of opportunities to explore which filters work best for our scenario.
* `kernel_size` is the size of the sliding window. Usually 3x3 or 5x5 filters are used.

Simplest CNN will contain one convolutional layer. Given the input size 28x28, after applying nine 5x5 filters we will end up with a tensor of 9x24x24 (the spatial size is smaller, because there are only 24 positions where a sliding interval of length 5 can fit into 28 pixels).

After convolution, we flatten 9x24x24 tensor into one vector of size 5184, and then add linear layer, to produce 10 classes. We also use `relu` activation function in between layers. 

```python
class OneConv(nn.Module):
    def __init__(self):
        super(OneConv, self).__init__()
        self.conv = nn.Conv2d(in_channels=1,out_channels=9,kernel_size=(5,5))
        self.flatten = nn.Flatten()
        self.fc = nn.Linear(5184,10)

    def forward(self, x):
        x = nn.functional.relu(self.conv(x))
        x = self.flatten(x)
        x = nn.functional.log_softmax(self.fc(x),dim=1)
        return x

net = OneConv()

summary(net,input_size=(1,1,28,28))
```

You can see that this network contains around 50k trainable parameters, compared to around 80k in fully-connected multi-layered networks. This allows us to achieve good results even on smaller datasets, because convolutional networks generalize much better.

```python
hist = train(net,train_loader,test_loader,epochs=5)
plot_results(hist)
```

As you can see, we are able to achieve higher accuracy, and much faster, compared to the fully-connected networks from previous unit.

We can also visualize the weights of our trained convolutional layers, to try and make some more sense of what is going on:

```python
fig,ax = plt.subplots(1,9)
with torch.no_grad():
    p = next(net.conv.parameters())
    for i,x in enumerate(p):
        ax[i].imshow(x.detach().cpu()[0,...])
        ax[i].axis('off')
```

You can see that some of those filters look like they can recognize some oblique strokes, while others look pretty random. 

#### Multi-layered CNNs and pooling layers

First convolutional layers looks for primitive patterns, such as horizontal or vertical lines, but we can apply further convolutional layers on top of them to look for higher-level patterns, such as primitive shapes. Then more convolutional layers can combine those shapes into some parts of the picture, up to the final object that we are trying to classify. 

When doing so, we may also apply one trick: reducing the spatial size of the image. Once we have detected there is a horizontal stoke within sliding 3x3 window, it is not so important at which exact pixel it occurred. Thus we can "scale down" the size of the image, which is done using one of the **pooling layers**:

 * **Average Pooling** takes a sliding window (for example, 2x2 pixels) and computes an average of values within the window
 * **Max Pooling** replaces the window with the maximum value. The idea behind max pooling is to detect a presence of a certain pattern within the sliding window.

Thus, in a typical CNN there would be several convolutional layers, with pooling layers in between them to decrease dimensions of the image. We would also increase the number of filters, because as patterns become more advanced - there are more possible interesting combinations that we need to be looking for.

![An image showing several convolutional layers with pooling layers.](./images/cnn-pyramid.png)

Because of decreasing spatial dimensions and increasing feature/filters dimensions, this architecture is also called **pyramid architecture**. 

```python
class MultiLayerCNN(nn.Module):
    def __init__(self):
        super(MultiLayerCNN, self).__init__()
        self.conv1 = nn.Conv2d(1, 10, 5)
        self.pool = nn.MaxPool2d(2, 2)
        self.conv2 = nn.Conv2d(10, 20, 5)
        self.fc = nn.Linear(320,10)

    def forward(self, x):
        x = self.pool(nn.functional.relu(self.conv1(x)))
        x = self.pool(nn.functional.relu(self.conv2(x)))
        x = x.view(-1, 320)
        x = nn.functional.log_softmax(self.fc(x),dim=1)
        return x

net = MultiLayerCNN()
summary(net,input_size=(1,1,28,28))
```

Note a few things about this definition:
* Instead of using `Flatten` layer, we are flattening the tensor inside `forward` function using `view` function. Since flattening layer does not have trainable weights, it is not essential that we create a separate layer instance within our class
* We use just one instance of pooling layer in our model, also because it does not contain any trainable parameters, and this one instance can be effectively reused
* The number of trainable parameters (~8.5K) is dramatically smaller than in previous cases. This happens because convolutional layers in general have few parameters, and dimensionality of the image before applying final dense layer is significantly reduced. Small number of parameters have positive impact on our models, because it helps to prevent overfitting even on smaller dataset sizes.

```python
hist = train(net,train_loader,test_loader,epochs=5)
```

What you should probably observe is that we are able to achieve higher accuracy than with just one layer, and much faster - just with 1 or 2 epochs. It means that sophisticated network architecture needs much fewer data to figure out what is going on, and to extract generic patterns from our images.

#### Playing with real images from the CIFAR-10 dataset

While our handwritten digit recognition problem may seem like a toy problem, we are now ready to do something more serious. Let's explore more advanced dataset of pictures of different objects, called [CIFAR-10](https://www.cs.toronto.edu/~kriz/cifar.html). It contains 60k 32x32 images, divided into 10 classes. 

```python
transform = torchvision.transforms.Compose(
    [torchvision.transforms.ToTensor(),
     torchvision.transforms.Normalize((0.5, 0.5, 0.5), (0.5, 0.5, 0.5))])

trainset = torchvision.datasets.CIFAR10(root='./data', train=True, download=True, transform=transform)
trainloader = torch.utils.data.DataLoader(trainset, batch_size=14, shuffle=True)
testset = torchvision.datasets.CIFAR10(root='./data', train=False, download=True, transform=transform)
testloader = torch.utils.data.DataLoader(testset, batch_size=14, shuffle=False)
classes = ('plane', 'car', 'bird', 'cat',
           'deer', 'dog', 'frog', 'horse', 'ship', 'truck')
```

```python
display_dataset(trainset,classes=classes)
```

A well-known architecture for CIFAR-10 is called [LeNet](https://en.wikipedia.org/wiki/LeNet), and has been proposed by *Yann LeCun*. It follows the same principles as we have outlined above, the main difference being 3 input color channels instead of 1. 

We also do one more simplification to this model - we do not use `log_softmax` as output activation function, and just return the output of last fully-connected layer. In this case we can just use `CrossEntropyLoss` loss function to optimize the model.

```python
class LeNet(nn.Module):
    def __init__(self):
        super(LeNet, self).__init__()
        self.conv1 = nn.Conv2d(3, 6, 5)
        self.pool = nn.MaxPool2d(2)
        self.conv2 = nn.Conv2d(6, 16, 5)
        self.conv3 = nn.Conv2d(16,120,5)
        self.flat = nn.Flatten()
        self.fc1 = nn.Linear(120,64)
        self.fc2 = nn.Linear(64,10)

    def forward(self, x):
        x = self.pool(nn.functional.relu(self.conv1(x)))
        x = self.pool(nn.functional.relu(self.conv2(x)))
        x = nn.functional.relu(self.conv3(x))
        x = self.flat(x)
        x = nn.functional.relu(self.fc1(x))
        x = self.fc2(x)
        return x

net = LeNet()

summary(net,input_size=(1,3,32,32))
```

Training this network properly will take significant amount of time, and should preferably be done on GPU-enabled compute.

```python
opt = torch.optim.SGD(net.parameters(),lr=0.001,momentum=0.9)
hist = train(net, trainloader, testloader, epochs=3, optimizer=opt, loss_fn=nn.CrossEntropyLoss())
```

The accuracy that we have been able to achieve with 3 epochs of training does not seem great. However, remember that blind guessing would only give us 10% accuracy, and that our problem is actually significantly more difficult than MNIST digit classification. Getting above 50% accuracy in such a short training time seems like a good accomplishment.

#### Takeaways

In this unit, we have learned the main concept behind computer vision neural networks - convolutional networks. Real-life architectures that power image classification, object detection, and even image generation networks are all based on CNNs, just with more layers and some additional training tricks.

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/07-ConvNets/ConvNetsTF.ipynb`）:

We have seen before that neural networks are quite good at dealing with images, and even one-layer perceptron is able to recognize handwritten digits from MNIST dataset with reasonable accuracy. However, MNIST dataset is very special, and all digits are centered inside the image, which makes the task simpler.

In real life, we want to be able to recognize objects on the picture regardless of their exact location in the image. Computer vision is different from generic classification, because when we are trying to find a certain object in the picture, we are scanning the image looking for some specific **patterns** and their combinations. For example, when looking for a cat, we first may look for horizontal lines, which can form whiskers, and then certain combination of whiskers can tell us that it is actually a picture of a cat. Relative position and presence of certain patterns is important, and not their exact position on the image.  

To extract patterns, we will use the notion of **convolutional filters**. But first, let us load all dependencies and functions that we have defined in the previous units. We will also import `tfcv` helper library that contain some useful functions that we do not want to define inside this notebook to keep the code short and clean. 

```python
import tensorflow as tf
from tensorflow import keras
import matplotlib.pyplot as plt
import numpy as np
from tfcv import *
```

In this example, we will focus on the MNIST dataset that we have seen before, and on image classification. We will start by loading the dataset using Keras built-in functions.

```python
(x_train,y_train),(x_test,y_test) = keras.datasets.mnist.load_data()
x_train = x_train.astype(np.float32) / 255.0
x_test = x_test.astype(np.float32) / 255.0
```

#### Convolutional filters

Convolutional filters are small windows that run over each pixel of the image and compute weighted average of the neighboring pixels.

They are defined by matrices of weight coefficients. Let's see the examples of applying two different convolutional filters over our MNIST handwritten digits:

```python
plot_convolution(x_train[:5],[[-1.,0.,1.],[-1.,0.,1.],[-1.,0.,1.]],'Vertical edge filter')
plot_convolution(x_train[:5],[[-1.,-1.,-1.],[0.,0.,0.],[1.,1.,1.]],'Horizontal edge filter')
```

First filter is called a **vertical edge filter**, and it is defined by the following matrix:
$$
\left(
    \begin{matrix}
     -1 & 0 & 1 \cr
     -1 & 0 & 1 \cr
     -1 & 0 & 1 \cr
    \end{matrix}
\right)
$$
When this filter goes over relatively uniform pixel field, all values add up to 0. However, when it encounters a vertical edge in the image, high spike value is generated. That's why in the images above you can see vertical edges represented by high and low values, while horizontal edges are averaged out.

An opposite thing happens when we apply horizontal edge filter - horizontal lines are amplified, and vertical are averaged out.

In classical computer vision, multiple filters were applied to the image to generate features, which then were used by machine learning algorithm to build a classifier. Those filters are in fact similar to neural structures that are available in the vision system of some animals.

<img src="images/lmfilters.jpg" width="400"/>

However, in deep learning we construct networks that **learn** best convolutional filters to solve classification problem. To do that, we introduce **convolutional layers**.

#### Covolutional layers

To make the weights of convolutional layer trainable, we need somehow to reduce the process of applying convolutional filter window to the image to the matrix operations, which can then be subject to backward propagation training. To do this, we use a clever matrix transformation, which we call **im2col**.

Suppose we have a small image $\mathbf{x}$, with the following pixels:

$$
\mathbf{x} = \left(
         \begin{array}{ccccc}
           a & b & c & d & e \\
           f & g & h & i & j \\
           k & l & m & n & o \\
           p & q & r & s & t \\
           u & v & w & x & y \\
         \end{array}
     \right)
$$

And we want to apply two conv filters, with the following weights:
$$
W^{(i)} = \left(\begin{array}{ccc}
            w^{(i)}_{00} & w^{(i)}_{01} & w^{(i)}_{02} \\
            w^{(i)}_{10} & w^{(i)}_{11} & w^{(i)}_{12} \\
            w^{(i)}_{20} & w^{(i)}_{21} & w^{(i)}_{22} \\
            \end{array}\right) 
$$

When applying the convolution, the first pixel of the result would be obtained by element-wise multiplication of 
$\left(\begin{array}{ccc}
  a & b & c \\
  f & g & h \\
  k & l & m \\
\end{array}\right)$ and $W^{(i)}$, the second element - by multiplying by $\left(\begin{array}{ccc}
  b & c & d \\
  g & h & i \\
  l & m & n \\
\end{array}\right)$ by $W^{(i)}$, and so on.

To formalize this process, let's extract all $3\times3$ fragments of the original image $x$ into the following matrix:

$$
\mathrm{im2col}(x) = \left[
        \begin{array}{cccccc}
          a & b & \ldots & g & \ldots & m \\
          b & c & \ldots & h & \ldots & n \\
          c & d & \ldots & i & \ldots & o \\
          f & g & \ldots & l & \ldots & r \\
          g & h & \ldots & m & \ldots & s \\
          h & i & \ldots & n & \ldots & t \\
          k & l & \ldots & q & \ldots & w \\
          l & m & \ldots & r & \ldots & x \\
          m & n & \ldots & s & \ldots & y \\
        \end{array}
    \right]
$$

Each column of this matrix corresponds to each $3\times3$ subregion of the original image. Now, to get the result of the convolution, we just need to multiply this matrix by the matrix or weights
$$
\mathbf{W} = \left[
         \begin{array}{cccccccc}
            w^{(0)}_{00} & w^{(0)}_{01} & w^{(0)}_{02} & w^{(0)}_{10} & w^{(0)}_{11} & \ldots & w^{(0)}_{21} & w^{(0)}_{22} \\
            w^{(1)}_{00} & w^{(1)}_{01} & w^{(1)}_{02} & w^{(1)}_{10} & w^{(1)}_{11} & \ldots & w^{(1)}_{21} & w^{(1)}_{22} \\
         \end{array}
       \right]
$$
(each row of this matrix contains weights of $i$-th filter, flattened into one row)

So the application of a convolution filter to the original image can be replaced by matrix multiplication, which we already know how to handle using back prop:
$$
C(x) = W\times\mathbf{im2col}(x)
$$

Convolutional layers are defined using `Conv2d` class. We need to specify the following:
* `filters` - number of filters to use. We will use 9 different filters, which will give the network plenty of opportunities to explore which filters work best for our scenario.
* `kernel_size` is the size of the sliding window. Usually 3x3 or 5x5 filters are used.

Simplest CNN will contain one convolutional layer. Given the input size 28x28, after applying nine 5x5 filters we will end up with a tensor of 24x24x9. The spatial dimension is smaller, because there are only 24 positions where a sliding interval of length 5 can fit into 28 pixels).

After convolution, we flatten 24x24x9 tensor into one vector of size 5184, and then add linear layer, to produce 10 classes. We also use `relu` activation function in between layers. 

```python
model = keras.models.Sequential([
    keras.layers.Conv2D(filters=9, kernel_size=(5,5), input_shape=(28,28,1),activation='relu'),
    keras.layers.Flatten(),
    keras.layers.Dense(10)
])

model.compile(loss=keras.losses.SparseCategoricalCrossentropy(from_logits=True),metrics=['acc'])

model.summary()
```

You can see that this network contains around 50k trainable parameters, compared to around 80k in fully-connected multi-layered networks. This allows us to achieve good results even on smaller datasets, because convolutional networks generalize much better.

> **Note**: In most of the practical cases, we want to apply convolutional layers to color images. Thus, `Conv2D` layer expects the input to be of the shape $W\times H\times C$, where $W$ and $H$ are width and height of the image, and $C$ is the number of color channels. For grayscale images, we need the same shape with $C=1$.

We need to reshape our data before starting training:

```python
x_train_c = np.expand_dims(x_train,3)
x_test_c = np.expand_dims(x_test,3)
hist = model.fit(x_train_c,y_train,validation_data=(x_test_c,y_test),epochs=5)
```

```python
plot_results(hist)
```

As you can see, we are able to achieve higher accuracy, and much faster (in terms of number of epochs), compared to the fully-connected networks from previous unit. However, the training itself requires more resources, and may be slower on non-GPU computers.

#### Visualizing Convolutional Layers

We can also visualize the weights of our trained convolutional layers, to try and make some more sense of what is going on:

```python
fig,ax = plt.subplots(1,9)
l = model.layers[0].weights[0]
for i in range(9):
    ax[i].imshow(l[...,0,i])
    ax[i].axis('off')
```

You can see that some of those filters look like they can recognize some oblique strokes, while others look pretty random. 

> **Task**: Train the same network with 3x3 filters and visualize them. Do you see more familiar patterns?

#### Multi-layered CNNs and pooling layers

First convolutional layers looks for primitive patterns, such as horizontal or vertical lines, but we can apply further convolutional layers on top of them to look for higher-level patterns, such as primitive shapes. Then more convolutional layers can combine those shapes into some parts of the picture, up to the final object that we are trying to classify. 

When doing so, we may also apply one trick: reducing the spatial size of the image. Once we have detected there is a horizontal stoke within sliding 3x3 window, it is not so important at which exact pixel it occurred. Thus we can "scale down" the size of the image, which is done using one of the **pooling layers**:

 * **Average Pooling** takes a sliding window (for example, 2x2 pixels) and computes an average of values within the window
 * **Max Pooling** replaces the window with the maximum value. The idea behind max pooling is to detect a presence of a certain pattern within the sliding window.

Thus, in a typical CNN there would be several convolutional layers, with pooling layers in between them to decrease dimensions of the image. We would also increase the number of filters, because as patterns become more advanced - there are more possible interesting combinations that we need to be looking for.

![An image showing several convolutional layers with pooling layers.](./images/cnn-pyramid.png)

Because of decreasing spatial dimensions and increasing feature/filters dimensions, this architecture is also called **pyramid architecture**. 

```python
model = keras.models.Sequential([
    keras.layers.Conv2D(filters=10, kernel_size=(5,5), input_shape=(28,28,1),activation='relu'),
    keras.layers.MaxPooling2D(),
    keras.layers.Conv2D(filters=20, kernel_size=(5,5), activation='relu'),
    keras.layers.MaxPooling2D(),    
    keras.layers.Flatten(),
    keras.layers.Dense(10)
])

model.compile(loss=keras.losses.SparseCategoricalCrossentropy(from_logits=True),metrics=['acc'])

model.summary()
```

Notice that the number of trainable parameters (~8.5K) is dramatically smaller than in previous cases. This happens because convolutional layers in general have few parameters, and dimensionality of the image before applying final dense layer is significantly reduced. Small number of parameters have positive impact on our models, because it helps to prevent overfitting even on smaller dataset sizes.

```python
hist = model.fit(x_train_c,y_train,validation_data=(x_test_c,y_test),epochs=5)
```

```python
plot_results(hist)
```

What you should probably observe is that we are able to achieve higher accuracy than with just one layer, and much faster in terms of number of epochs - just with 1 or 2 epochs. It means that sophisticated network architecture needs much fewer data to figure out what is going on, and to extract generic patterns from our images. However, training also takes longer, and requires a GPU.

#### Playing with real images from the CIFAR-10 dataset

While our handwritten digit recognition problem may seem like a toy problem, we are now ready to do something more serious. Let's explore more advanced dataset of pictures of different objects, called [CIFAR-10](https://www.cs.toronto.edu/~kriz/cifar.html). It contains 60k 32x32 images, divided into 10 classes. 

```python
(x_train,y_train),(x_test,y_test) = keras.datasets.cifar10.load_data()
x_train = x_train.astype(np.float32) / 255.0
x_test = x_test.astype(np.float32) / 255.0
classes = ('plane', 'car', 'bird', 'cat',
           'deer', 'dog', 'frog', 'horse', 'ship', 'truck')
```

```python
display_dataset(x_train,y_train,classes=classes)
```

A well-known architecture for CIFAR-10 is called [LeNet](https://en.wikipedia.org/wiki/LeNet), and has been proposed by *Yann LeCun*. It follows the same principles as we have outlined above, the main difference being 3 input color channels instead of 1. 

```python
model = keras.models.Sequential([
    keras.layers.Conv2D(filters = 6, kernel_size = 5, strides = 1, activation = 'relu', input_shape = (32,32,3)),
    keras.layers.MaxPooling2D(pool_size = 2, strides = 2),
    keras.layers.Conv2D(filters = 16, kernel_size = 5, strides = 1, activation = 'relu'),
    keras.layers.MaxPooling2D(pool_size = 2, strides = 2),
    keras.layers.Flatten(),
    keras.layers.Dense(120, activation = 'relu'),
    keras.layers.Dense(84, activation = 'relu'),
    keras.layers.Dense(10, activation = 'softmax')])

model.summary()
```

Training this network properly will take significant amount of time, and should preferably be done on GPU-enabled compute.

```python
model.compile(optimizer = 'adam', loss = 'sparse_categorical_crossentropy', metrics = ['acc'])
hist = model.fit(x_train,y_train,validation_data=(x_test,y_test),epochs=10)
```

```python
plot_results(hist)
```

The accuracy that we have been able to achieve with few epochs of training does not seem too great. However, remember that bling guessing would only give us 10% accuracy, and that our problem is actually significantly more difficult than MNIST digit classification. Getting above 50% accuracy in such a short training time seems like a good accomplishment.

#### Takeaways

In this unit, we have learned the main concept behind computer vision neural networks - convolutional networks. Real-life architectures that power image classification, object detection, and even image generation networks are all based on CNNs, just with more layers and some additional training tricks.

---

**🔧 练习**（来自 `lessons/4-ComputerVision/07-ConvNets/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

Imagine you need to develop and application for pet nursery to catalog all pets. One of the great features of such an application would be automatically discovering the breed from a photograph. This can be successfully done using neural networks.

You need to train a convolutional neural network to classify different breeds of cats and dogs using **Pet Faces** dataset.

#### The Dataset

We will use the [Oxford-IIIT Pet Dataset](https://www.robots.ox.ac.uk/~vgg/data/pets/), which contains images of 37 different breeds of dogs and cats.

![Dataset we will deal with](images/data.png)

To download the dataset, use this code snippet:

```python
!wget https://thor.robots.ox.ac.uk/~vgg/data/pets/images.tar.gz
!tar xfz images.tar.gz
!rm images.tar.gz
```

**Note:** The Oxford-IIIT Pet Dataset images are organized by filename (e.g., `Abyssinian_1.jpg`, `Bengal_2.jpg`). The notebook includes code to organize these images into breed-specific subdirectories for easier classification.

#### Stating Notebook

Start the lab by opening [PetFaces.ipynb](PetFaces.ipynb)

#### Takeaway

You have solved a relatively complex problem of image classification from scratch! There were quite a lot of classes, and you were still able to get reasonable accuracy! It also makes sense to measure top-k accuracy, because it is easy to confuse some of the classes which are not clearly different even to human beings.

### Convolutional Neural Networks

We have seen before that neural networks are quite good at dealing with images, and even one-layer perceptron is able to recognize handwritten digits from MNIST dataset with reasonable accuracy. However, the MNIST dataset is very special, and all digits are centered inside the image, which makes the task simpler.

In real life, we want to be able to recognize objects on a picture regardless of their exact location in the image. Computer vision is different from generic classification, because when we are trying to find a certain object in the picture, we are scanning the image looking for some specific **patterns** and their combinations. For example, when looking for a cat, we first may look for horizontal lines, which can form whiskers, and then certain a combination of whiskers can tell us that it is actually a picture of a cat. Relative position and presence of certain patterns is important, and not their exact position on the image.

To extract patterns, we will use the notion of **convolutional filters**. As you know, an image is represented by a 2D-matrix, or a 3D-tensor with color depth. Applying a filter means that we take relatively small **filter kernel** matrix, and for each pixel in the original image we compute the weighted average with neighboring points. We can view this like a small window sliding over the whole image, and averaging out all pixels according to the weights in the filter kernel matrix.

![Vertical Edge Filter](images/filter-vert.png) | ![Horizontal Edge Filter](images/filter-horiz.png)
----|----

> Image by Dmitry Soshnikov

For example, if we apply 3x3 vertical edge and horizontal edge filters to the MNIST digits, we can get highlights (e.g. high values) where there are vertical and horizontal edges in our original image. Thus those two filters can be used to "look for" edges. Similarly, we can design different filters to look for other low-level patterns:

<img src="images/lmfilters.jpg" width="500" align="center"/>

> Image of [Leung-Malik Filter Bank](https://www.robots.ox.ac.uk/~vgg/research/texclass/filters.html)

However, while we can design the filters to extract some patterns manually, we can also design the network in such a way that it will learn the patterns automatically. It is one of the main ideas behind the CNN.

#### Main ideas behind CNN

The way CNNs work is based on the following important ideas:

* Convolutional filters can extract patterns
* We can design the network in such a way that filters are trained automatically
* We can use the same approach to find patterns in high-level features, not only in the original image. Thus CNN feature extraction work on a hierarchy of features, starting from low-level pixel combinations, up to higher level combination of picture parts.

![Hierarchical Feature Extraction](images/FeatureExtractionCNN.png)

> Image from [a paper by Hislop-Lynch](https://www.semanticscholar.org/paper/Computer-vision-based-pedestrian-trajectory-Hislop-Lynch/26e6f74853fc9bbb7487b06dc2cf095d36c9021d), based on [their research](https://dl.acm.org/doi/abs/10.1145/1553374.1553453)

#### ✍️ Exercises: Convolutional Neural Networks

Let's continue exploring how convolutional neural networks work, and how we can achieve trainable filters, by working through the corresponding notebooks:

* [Convolutional Neural Networks - PyTorch](ConvNetsPyTorch.ipynb)
* [Convolutional Neural Networks - TensorFlow](ConvNetsTF.ipynb)

#### Pyramid Architecture

Most of the CNNs used for image processing follow a so-called pyramid architecture. The first convolutional layer applied to the original images typically has a relatively low number of filters (8-16), which correspond to different pixel combinations, such as horizontal/vertical lines of strokes. At the next level, we reduce the spatial dimension of the network, and increase the number of filters, which corresponds to more possible combinations of simple features. With each layer, as we move towards the final classifier, spatial dimensions of the image decrease, and the number of filters grow.

As an example, let's look at the architecture of VGG-16, a network that achieved 92.7% accuracy in ImageNet's top-5 classification in 2014:

![ImageNet Layers](images/vgg-16-arch1.jpg)

![ImageNet Pyramid](images/vgg-16-arch.jpg)

> Image from [Researchgate](https://www.researchgate.net/figure/Vgg16-model-structure-To-get-the-VGG-NIN-model-we-replace-the-2-nd-4-th-6-th-7-th_fig2_335194493)

#### Best-Known CNN Architectures

[Continue your study about the best-known CNN architectures](CNN_Architectures.md)

---

**🔧 练习**（来自 `lessons/4-ComputerVision/08-TransferLearning/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

Imagine you need to develop and application for pet nursery to catalog all pets. One of the great features of such an application would be automatically discovering the breed from a photograph. In this assignment, we will use transfer learning to classify real-life pet images from [Oxford-IIIT](https://www.robots.ox.ac.uk/~vgg/data/pets/) pets dataset.

#### The Dataset

We will use the original [Oxford-IIIT](https://www.robots.ox.ac.uk/~vgg/data/pets/) pets dataset, which contains 35 different breeds of dogs and cats.

To download the dataset, use this code snippet:

```python
!wget https://www.robots.ox.ac.uk/~vgg/data/pets/data/images.tar.gz
!tar xfz images.tar.gz
!rm images.tar.gz
```

#### Stating Notebook

Start the lab by opening [OxfordPets.ipynb](OxfordPets.ipynb)

#### Takeaway

Transfer learning and pre-trained networks allow us to solve real-world image classification problems relatively easily. However, pre-trained networks work well on images of similar kind, and if we start classifying very different images (eg. medical images), we are likely to get much worse results.

### Pre-trained Networks and Transfer Learning

Training CNNs can take a lot of time, and a lot of data is required for that task. However, much of the time is spent learning the best low-level filters that a network can use to extract patterns from images. A natural question arises - can we use a neural network trained on one dataset and adapt it to classify different images without requiring a full training process?

This approach is called **transfer learning**, because we transfer some knowledge from one neural network model to another. In transfer learning, we typically start with a pre-trained model, which has been trained on some large image dataset, such as **ImageNet**. Those models can already do a good job extracting different features from generic images, and in many cases just building a classifier on top of those extracted features can yield a good result.

> ✅ Transfer Learning is a term you find in other academic fields, such as Education. It refers to the process of taking knowledge from one domain and applying it to another.

#### Pre-Trained Models as Feature Extractors

The convolutional networks that we have talked about in the previous section contained a number of layers, each of which is supposed to extract some features from the image, starting from low-level pixel combinations (such as horizontal/vertical line or stroke), up to higher level combinations of features, corresponding to things like an eye of a flame. If we train CNN on sufficiently large dataset of generic and diverse images, the network should learn to extract those common features.

Both Keras and PyTorch contain functions to easily load pre-trained neural network weights for some common architectures, most of which were trained on ImageNet images. The most often used ones are described on the [CNN Architectures](../07-ConvNets/CNN_Architectures.md) page from the prior lesson. In particular, you may want to consider using one of the following:

* **VGG-16/VGG-19** which are relatively simple models that still give good accuracy. Often using VGG as a first attempt is a good choice to see how transfer learning is working.
* **ResNet** is a family of models proposed by Microsoft Research in 2015. They have more layers, and thus take more resources.
* **MobileNet** is a family of models with reduced size, suitable for mobile devices. Use them if you are short in resources and can sacrifice a little bit of accuracy.

Here are sample features extracted from a picture of a cat by VGG-16 network:

![Features extracted by VGG-16](images/features.png)

#### Cats vs. Dogs Dataset

In this example, we will use a dataset of [Cats and Dogs](https://www.microsoft.com/download/details.aspx?id=54765&WT.mc_id=academic-77998-cacaste), which is very close to a real-life image classification scenario.

#### ✍️ Exercise: Transfer Learning

Let's see transfer learning in action in corresponding notebooks:

* [Transfer Learning - PyTorch](TransferLearningPyTorch.ipynb)
* [Transfer Learning - TensorFlow](TransferLearningTF.ipynb)

#### Visualizing Adversarial Cat

Pre-trained neural network contains different patterns inside it's *brain*, including notions of **ideal cat** (as well as ideal dog, ideal zebra, etc.). It would be interesting to somehow **visualize this image**. However, it is not simple, because patterns are spread all over the network weights, and also organized in a hierarchical structure.

One approach we can take is to start with a random image, and then try to use **gradient descent optimization** technique to adjust that image in such a way, that the network starts thinking that it's a cat. 

![Image Optimization Loop](images/ideal-cat-loop.png)

However, if we do this, we will receive something very similar to a random noise. This is because *there are many ways to make network think the input image is a cat*, including some that do not make sense visually. While those images contain a lot of patterns typical for a cat, there is nothing to constrain them to be visually distinctive.

To improve the result, we can add another term into the loss function, which is called **variation loss**. It is a metric that shows how similar neighboring pixels of the image are. Minimizing variation loss makes image smoother, and gets rid of noise - thus revealing more visually appealing patterns. Here is an example of such "ideal" images, that are classified as cat and as zebra with high probability:

![Ideal Cat](images/ideal-cat.png) | ![Ideal Zebra](images/ideal-zebra.png)
-----|-----
 *Ideal Cat* | *Ideal Zebra*

Similar approach can be used to perform so-called **adversarial attacks** on a neural network. Suppose we want to fool a neural network and make a dog look like a cat. If we take dog's image, which is recognized by a network as a dog, we can then tweak it a little but using gradient descent optimization, until the network starts classifying it as a cat:

![Picture of a Dog](images/original-dog.png) | ![Picture of a dog classified as a cat](images/adversarial-dog.png)
-----|-----
*Original picture of a dog* | *Picture of a dog classified as a cat*

See the code to reproduce the results above in the following notebook:

* [Ideal and Adversarial Cat - TensorFlow](AdversarialCat_TF.ipynb)
#### Conclusion

Using transfer learning, you are able to quickly put together a classifier for a custom object classification task and achieve high accuracy. You can see that more complex tasks that we are solving now require higher computational power, and cannot be easily solved on the CPU. In the next unit, we will try to use a more lightweight implementation to train the same model using lower compute resources, which results in just slightly lower accuracy.

#### 🚀 Challenge

In the accompanying notebooks, there are notes at the bottom about how transfer knowledge works best with somewhat similar training data (a new type of animal, perhaps). Do some experimentation with completely new types of images to see how well or poorly your transfer knowledge models perform.

#### Review & Self Study

Read through [TrainingTricks.md](TrainingTricks.md) to deepen your knowledge of some other way to train your models.

### Momentum

In **momentum SGD**, we are keeping a portion of a gradient from previous steps. It is similar to when we are moving somewhere with inertia, and we receive a punch in a different direction, our trajectory does not change immediately, but keeps some part of the original movement. Here we introduce another vector v to represent the *speed*:

* v<sup>t+1</sup> = &gamma; v<sup>t</sup> - &eta;&nabla;&lagran;
* w<sup>t+1</sup> = w<sup>t</sup>+v<sup>t+1</sup>

Here parameter &gamma; indicates the extent to which we take inertia into account: &gamma;=0 corresponds to classical SGD; &gamma;=1 is a pure motion equation.

### Adam, Adagrad, etc

Since in each layer we multiply signals by some matrix W<sub>i</sub>, depending on ||W<sub>i</sub>||, the gradient can either diminish and be close to 0, or rise indefinitely. It is the essence of Exploding/Vanishing Gradients problem.

One of the solutions to this problem is to use only direction of the gradient in the equation, and ignore the absolute value, i.e.

w<sup>t+1</sup> = w<sup>t</sup> - &eta;(&nabla;&lagran;/||&nabla;&lagran;||), where ||&nabla;&lagran;|| = &radic;&sum;(&nabla;&lagran;)<sup>2</sup>

This algorithm is called **Adagrad**. Another algorithms that use the same idea: **RMSProp**, **Adam**

> **Adam** is considered to be a very efficient algorithm for many applications, so if you are not sure which one to use - use Adam.

### Gradient clipping

Gradient clipping is an extension the idea above. When the ||&nabla;&lagran;|| &le; &theta;, we consider the original gradient in the weight optimization, and when ||&nabla;&lagran;|| > &theta; - we divide the gradient by it's norm. Here &theta; is a parameter, in most cases we can take &theta;=1 or &theta;=10.

### Learning rate decay

Training success often depends on the learning rate parameter &eta;. It is logical to assume that larger values of &eta; result in faster training, which is something we typically want in the beginning of the training, and then smaller value of &eta; allow us to fine-tune the network. Thus, in most of the cases we want to decrease &eta; in the process of the training.

This can be done by multiplying &eta; by some number (eg. 0.98) after each epoch of the training, or by using more complicated **learning rate schedule**.

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/08-TransferLearning/TransferLearningPyTorch.ipynb`）:

Training CNNs can take a lot of time, and a lot of data is required for that task. However, much of the time is spent to learn the best low-level filters that a network is using to extract patterns from images. A natural question arises - can we use a neural network trained on one dataset and adapt it to classifying different images without full training process?

This approach is called **transfer learning**, because we transfer some knowledge from one neural network model to another. In transfer learning, we typically start with a pre-trained model, which has been trained on some large image dataset, such as **ImageNet**. Those models can already do a good job extracting different features from generic images, and in many cases just building a classifier on top of those extracted features can yield a good result.

```python
import torch
import torch.nn as nn
import torchvision
import torchvision.transforms as transforms
import matplotlib.pyplot as plt
from torchinfo import summary
import numpy as np
import os

from pytorchcv import train, plot_results, display_dataset, train_long, check_image_dir
```

#### Cats vs. Dogs Dataset

In this unit, we will solve a real-life problem of classifying images of cats and dogs. For this reason, we will use [Kaggle Cats vs. Dogs Dataset](https://www.kaggle.com/c/dogs-vs-cats), which can also be downloaded [from Microsoft](https://www.microsoft.com/en-us/download/details.aspx?id=54765).

Let's download this dataset and extract it into `data` directory (this process may take some time!):

```python
if not os.path.exists('data/kagglecatsanddogs_5340.zip'):
    !wget -P data https://download.microsoft.com/download/3/E/1/3E1C3F21-ECDB-4869-8368-6DEBA77B919F/kagglecatsanddogs_5340.zip
```

```python
import zipfile
if not os.path.exists('data/PetImages'):
    with zipfile.ZipFile('data/kagglecatsanddogs_5340.zip', 'r') as zip_ref:
        zip_ref.extractall('data')
```

Unfortunately, there are some corrupt image files in the dataset. We need to do quick cleaning to check for corrupted files. In order not to clobber this tutorial, we moved the code to verify dataset into a module.

```python
check_image_dir('data/PetImages/Cat/*.jpg')
check_image_dir('data/PetImages/Dog/*.jpg')
```

Next, let's load the images into PyTorch dataset, converting them to tensors and doing some normalization. We will apply `std_normalize` transform to bring images to the range expected by pre-trained VGG network:

```python
std_normalize = transforms.Normalize(mean=[0.485, 0.456, 0.406],
                          std=[0.229, 0.224, 0.225])
trans = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(), 
        std_normalize])
dataset = torchvision.datasets.ImageFolder('data/PetImages',transform=trans)
trainset, testset = torch.utils.data.random_split(dataset,[20000,len(dataset)-20000])

display_dataset(dataset)
```

#### Pre-trained models

There are many different pre-trained models available inside `torchvision` module, and even more models can be found on the Internet. Let's see how simplest VGG-16 model can be loaded and used:

```python
vgg = torchvision.models.vgg16(pretrained=True)
sample_image = dataset[0][0].unsqueeze(0)
res = vgg(sample_image)
print(res[0].argmax())
```

The result that we have received is a number of an `ImageNet` class, which can be looked up [here](https://gist.github.com/yrevar/942d3a0ac09ec9e5eb3a). We can use the following code to automatically load this class table and return the result:

```python
import json, requests
class_map = json.loads(requests.get("https://s3.amazonaws.com/deep-learning-models/image-models/imagenet_class_index.json").text)
class_map = { int(k) : v for k,v in class_map.items() }

class_map[res[0].argmax().item()]
```

Let's also see the architecture of the VGG-16 network:

```python
summary(vgg,input_size=(1,3,224,224))
```

In addition to the layer we already know, there is also another layer type called **Dropout**. These layers act as **regularization** technique. Regularization makes slight modifications to the learning algorithm so the model generalizes better. During training, dropout layers discard some proportion (around 30%) of the neurons in the previous layer, and training happens without them. This helps to get the optimization process out of local minima, and to distribute decisive power between different neural paths, which improves overall stability of the network.

#### GPU computations

Deep neural networks, such as VGG-16 and other more modern architectures require quite a lot of computational power to run. It makes sense to use GPU acceleration, if it is available. In order to do so, we need to explicitly move all tensors involved in the computation to GPU.

The way it is normally done is to check the availability of GPU in the code, and define `device` variable that points to the computational device - either GPU or CPU.

```python
device = 'cuda' if torch.cuda.is_available() else 'cpu'

print('Doing computations on device = {}'.format(device))

vgg.to(device)
sample_image = sample_image.to(device)

vgg(sample_image).argmax()
```

#### Extracting VGG features

If we want to use VGG-16 to extract features from our images, we need the model without final classification layers. In fact, this "feature extractor" can be obtained using `vgg.features` method:

```python
res = vgg.features(sample_image).cpu()
plt.figure(figsize=(15,3))
plt.imshow(res.detach().view(512,-1).T)
print(res.size())
```

The dimension of feature tensor is 512x7x7, but in order to visualize it we had to reshape it to 2D form.

Now let's try to see if those features can be used to classify images. Let's manually take some portion of images (800 in our case), and pre-compute their feature vectors. We will store the result in one big tensor called `feature_tensor`, and also labels into `label_tensor`:

```python
bs = 8
dl = torch.utils.data.DataLoader(dataset,batch_size=bs,shuffle=True)
num = bs*100
feature_tensor = torch.zeros(num,512*7*7).to(device)
label_tensor = torch.zeros(num).to(device)
i = 0
for x,l in dl:
    with torch.no_grad():
        f = vgg.features(x.to(device))
        feature_tensor[i:i+bs] = f.view(bs,-1)
        label_tensor[i:i+bs] = l
        i+=bs
        print('.',end='')
        if i>=num:
            break

```

Now we can define `vgg_dataset` that takes data from this tensor, split it into training and test sets using `random_split` function, and train a small one-layer dense classifier network on top of extracted features:

```python
vgg_dataset = torch.utils.data.TensorDataset(feature_tensor,label_tensor.to(torch.long))
train_ds, test_ds = torch.utils.data.random_split(vgg_dataset,[700,100])

train_loader = torch.utils.data.DataLoader(train_ds,batch_size=32)
test_loader = torch.utils.data.DataLoader(test_ds,batch_size=32)

net = torch.nn.Sequential(torch.nn.Linear(512*7*7,2),torch.nn.LogSoftmax()).to(device)

history = train(net,train_loader,test_loader)
```

The result is great, we can distinguish between a cat and a dog with almost 98% probability! However, we have only tested this approach on a small subset of all images, because manual feature extraction seems to take a lot of time.

#### Transfer learning using one VGG network

We can also avoid manually pre-computing the features by using the original VGG-16 network as a whole during training. Let's look at the VGG-16 object structure:

```python
print(vgg)
```

You can see that the network contains:
* feature extractor (`features`), comprised of a number of convolutional and pooling layers
* average pooling layer (`avgpool`)
* final `classifier`, consisting of several dense layers, which turns 25088 input features into 1000 classes (which is the number of classes in ImageNet)

To train the end-to-end model that will classify our dataset, we need to:
* **replace the final classifier** with the one that will produce required number of classes. In our case, we can use one `Linear` layer with 25088 inputs and 2 output neurons.
* **freeze weights of convolutional feature extractor**, so that they are not trained. It is recommended to initially do this freezing, because otherwise untrained classifier layer can destroy the original pre-trained weights of convolutional extractor. Freezing weights can be accomplished by setting `requires_grad` property of all parameters to `False`

```python
vgg.classifier = torch.nn.Linear(25088,2).to(device)

for x in vgg.features.parameters():
    x.requires_grad = False

summary(vgg,(1, 3,244,244))
```

As you can see from the summary, this model contain around 15 million total parameters, but only 50k of them are trainable - those are the weights of classification layer. That is good, because we are able to fine-tune smaller number of parameters with smaller number of examples.

Now let's train the model using our original dataset. This process will take a long time, so we will use `train_long` function that will print some intermediate results without waiting for the end of epoch. It is highly recommended to run this training on GPU-enabled compute!

```python
trainset, testset = torch.utils.data.random_split(dataset,[20000,len(dataset)-20000])
train_loader = torch.utils.data.DataLoader(trainset,batch_size=16)
test_loader = torch.utils.data.DataLoader(testset,batch_size=16)

train_long(vgg,train_loader,test_loader,loss_fn=torch.nn.CrossEntropyLoss(),epochs=1,print_freq=90)
```

It looks like we have obtained reasonably accurate cats vs. dogs classifier! Let's save it for future use!

```python
torch.save(vgg,'data/cats_dogs.pth')
```

We can then load the model from file at any time. You may find it useful in case the next experiment destroys the model - you would not have to re-start from scratch.

```python
vgg = torch.load('data/cats_dogs.pth')
```

#### Fine-tuning transfer learning

In the previous section, we have trained the final classifier layer to classify images in our own dataset. However, we did not re-train the feature extractor, and our model relied on the features that the model has learned on ImageNet data. If your objects visually differ from ordinary ImageNet images, this combination of features might not work best. Thus it makes sense to start training convolutional layers as well.

To do that, we can unfreeze the convolutional filter parameters that we have previously frozen. 

> **Note:** It is important that you freeze parameters first and perform several epochs of training in order to stabilize weights in the classification layer. If you immediately start training end-to-end network with unfrozen parameters, large errors are likely to destroy the pre-trained weights in the convolutional layers.

```python
for x in vgg.features.parameters():
    x.requires_grad = True
```

After unfreezing, we can do a few more epochs of training. You can also select lower learning rate, in order to minimize the impact on the pre-trained weights. However, even with low learning rate, you can expect the accuracy to drop in the beginning of the training, until finally reaching slightly higher level than in the case of fixed weights.

> **Note:** This training happens much slower, because we need to propagate gradients back through many layers of the network! You may want to watch the first few minibatches to see the tendency, and then stop the computation.

```python
train_long(vgg,train_loader,test_loader,loss_fn=torch.nn.CrossEntropyLoss(),epochs=1,print_freq=90,lr=0.0001)
```

#### Other computer vision models

VGG-16 is one of the simplest computer vision architectures. `torchvision` package provides many more pre-trained networks. The most frequently used ones among those are **ResNet** architectures, developed by Microsoft, and **Inception** by Google. For example, let's explore the architecture of the simplest ResNet-18 model (ResNet is a family of models with different depth, you can try experimenting with ResNet-151 if you want to see what a really deep model looks like):

```python
resnet = torchvision.models.resnet18()
print(resnet)
```

As you can see, the model contains the same building blocks: feature extractor and final classifier (`fc`). This allows us to use this model in exactly the same manner as we have been using VGG-16 for transfer learning. You can try experimenting with the code above, using different ResNet models as the base model, and see how accuracy changes.

#### Batch Normalization

This network contains yet another type of layer: **Batch Normalization**. The idea of batch normalization is to bring values that flow through the neural network to right interval. Usually neural networks work best when all values are in the range of [-1,1] or [0,1], and that is the reason that we scale/normalize our input data accordingly. However, during training of a deep network, it can happen that values get significantly out of this range, which makes training problematic. Batch normalization layer computes average and standard deviation for all values of the current minibatch, and uses them to normalize the signal before passing it through a neural network layer. This significantly improves the stability of deep networks.

#### Takeaway

Using transfer learning, we were able to quickly put together a classifier for our custom object classification task, and achieve high accuracy. However, this example was not completely fair, because original VGG-16 network was pre-trained to recognize cats and dogs, and thus we were just reusing most of the patterns that were already present in the network. You can expect lower accuracy on more exotic domain-specific objects, such as details on production line in a plant, or different tree leaves.

You can see that more complex tasks that we are solving now require higher computational power, and cannot be easily solved on the CPU. In the next unit, we will try to use more lightweight implementation to train the same model using lower compute resources, which results in just slightly lower accuracy. 

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/09-Autoencoders/AutoEncodersPyTorch.ipynb`）:

When training CNNs, one of the problems is that we need a lot of labeled data. In the case of image classification, we need to separate images into different classes, which is a manual effort.

However, we might want to use raw (unlabeled) data for training CNN feature extractors, which is called **self-supervised learning**. Instead of labels, we will use training images as both network input and output. The main idea of **autoencoder** is that we will have an **encoder network** that converts input image into some **latent space** (normally it is just a vector of some smaller size), then the **decoder network**, whose goal would be to reconstruct the original image.

Since we are training autoencoder to capture as much of the information from the original image as possible for accurate reconstruction, the network tries to find the best **embedding** of input images to capture the meaning.

![AutoEncoder Diagram](images/autoencoder_schema.jpg)

> Image from [Keras blog](https://blog.keras.io/building-autoencoders-in-keras.html)

Let's create simplest autoencoder for MNIST!

```python
import torch
import torchvision
import matplotlib.pyplot as plt
from torchvision import transforms
from torch import nn
from torch import optim
from tqdm import tqdm
import numpy as np
import torch.nn.functional as F
torch.manual_seed(42)
np.random.seed(42)
```

Define training parameters and check if the GPU is available:

```python
device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
train_size = 0.9
lr = 1e-3
eps = 1e-8
batch_size = 256
epochs = 30
```

The following function will load the MNIST dataset and apply specified transforms to it. It will also split it into train/test datasets.

```python
def mnist(train_part, transform=None):
    dataset = torchvision.datasets.MNIST('.', download=True, transform=transform)
    train_part = int(train_part * len(dataset))
    train_dataset, test_dataset = torch.utils.data.random_split(dataset, [train_part, len(dataset) - train_part])
    return train_dataset, test_dataset
```

Now let's load the dataset and define dataloaders for train and test:

```python
transform = transforms.Compose([transforms.ToTensor()])

train_dataset, test_dataset = mnist(train_size, transform)

train_dataloader = torch.utils.data.DataLoader(train_dataset, drop_last=True, batch_size=batch_size, shuffle=True)
test_dataloader = torch.utils.data.DataLoader(test_dataset, batch_size=1, shuffle=False)
dataloaders = (train_dataloader, test_dataloader)
```

```python
def plotn(n, data, noisy=False, super_res=None):
    fig, ax = plt.subplots(1, n)
    for i, z in enumerate(data):
        if i == n:
            break
        preprocess = z[0].reshape(1, 28, 28) if z[0].shape[1] == 28 else z[0].reshape(1, 14, 14) if z[0].shape[1] == 14 else z[0]
        if super_res is not None:
            _transform = transforms.Resize((int(preprocess.shape[1] / super_res), int(preprocess.shape[2] / super_res)))
            preprocess = _transform(preprocess)

        if noisy:
            shapes = list(preprocess.shape)
            preprocess += noisify(shapes)

        ax[i].imshow(preprocess[0])
    plt.show()
```

```python
def noisify(shapes):
    return np.random.normal(loc=0.5, scale=0.3, size=shapes)
```

```python
plotn(5, train_dataset)
```

```python
class Encoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 16, kernel_size=(3, 3), padding='same')
        self.maxpool1 = nn.MaxPool2d(kernel_size=(2, 2))
        self.conv2 = nn.Conv2d(16, 8, kernel_size=(3, 3), padding='same')
        self.maxpool2 = nn.MaxPool2d(kernel_size=(2, 2))
        self.conv3 = nn.Conv2d(8, 8, kernel_size=(3, 3), padding='same')
        self.maxpool3 = nn.MaxPool2d(kernel_size=(2, 2), padding=(1, 1))
        self.relu = nn.ReLU()

    def forward(self, input):
        hidden1 = self.maxpool1(self.relu(self.conv1(input)))
        hidden2 = self.maxpool2(self.relu(self.conv2(hidden1)))
        encoded = self.maxpool3(self.relu(self.conv3(hidden2)))
        return encoded
```

```python
class Decoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(8, 8, kernel_size=(3, 3), padding='same')
        self.upsample1 = nn.Upsample(scale_factor=(2, 2))
        self.conv2 = nn.Conv2d(8, 8, kernel_size=(3, 3), padding='same')
        self.upsample2 = nn.Upsample(scale_factor=(2, 2))
        self.conv3 = nn.Conv2d(8, 16, kernel_size=(3, 3))
        self.upsample3 = nn.Upsample(scale_factor=(2, 2))
        self.conv4 = nn.Conv2d(16, 1, kernel_size=(3, 3), padding='same')
        self.relu = nn.ReLU()
        self.sigmoid = nn.Sigmoid()

    def forward(self, input):
        hidden1 = self.upsample1(self.relu(self.conv1(input)))
        hidden2 = self.upsample2(self.relu(self.conv2(hidden1)))
        hidden3 = self.upsample3(self.relu(self.conv3(hidden2)))
        decoded = self.sigmoid(self.conv4(hidden3))
        return decoded
```

```python
class AutoEncoder(nn.Module):
    def __init__(self, super_resolution=False):
        super().__init__()
        if not super_resolution:
            self.encoder = Encoder()
        else:
            self.encoder = SuperResolutionEncoder()
        self.decoder = Decoder()

    def forward(self, input):
        encoded = self.encoder(input)
        decoded = self.decoder(encoded)
        return decoded
```

```python
model = AutoEncoder().to(device)
optimizer = optim.Adam(model.parameters(), lr=lr, eps=eps)
loss_fn = nn.BCELoss()
```

```python
def train(dataloaders, model, loss_fn, optimizer, epochs, device, noisy=None, super_res=None):
    tqdm_iter = tqdm(range(epochs))
    train_dataloader, test_dataloader = dataloaders[0], dataloaders[1]

    for epoch in tqdm_iter:
        model.train()
        train_loss = 0.0
        test_loss = 0.0

        for batch in train_dataloader:
            imgs, labels = batch
            shapes = list(imgs.shape)

            if super_res is not None:
                shapes[2], shapes[3] = int(shapes[2] / super_res), int(shapes[3] / super_res)
                _transform = transforms.Resize((shapes[2], shapes[3]))
                imgs_transformed = _transform(imgs)
                imgs_transformed = imgs_transformed.to(device)

            imgs = imgs.to(device)
            labels = labels.to(device)

            if noisy is not None:
                noisy_tensor = noisy[0]
            else:
                noisy_tensor = torch.zeros(tuple(shapes)).to(device)

            if super_res is None:
                imgs_noisy = imgs + noisy_tensor
            else:
                imgs_noisy = imgs_transformed + noisy_tensor

            imgs_noisy = torch.clamp(imgs_noisy, 0., 1.)

            preds = model(imgs_noisy)
            loss = loss_fn(preds, imgs)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        model.eval()
        with torch.no_grad():
            for batch in test_dataloader:
                imgs, labels = batch
                shapes = list(imgs.shape)

                if super_res is not None:
                    shapes[2], shapes[3] = int(shapes[2] / super_res), int(shapes[3] / super_res)
                    _transform = transforms.Resize((shapes[2], shapes[3]))
                    imgs_transformed = _transform(imgs)
                    imgs_transformed = imgs_transformed.to(device)

                imgs = imgs.to(device)
                labels = labels.to(device)

                if noisy is not None:
                    test_noisy_tensor = noisy[1]
                else:
                    test_noisy_tensor = torch.zeros(tuple(shapes)).to(device)

                if super_res is None:
                    imgs_noisy = imgs + test_noisy_tensor
                else:
                    imgs_noisy = imgs_transformed + test_noisy_tensor

                imgs_noisy = torch.clamp(imgs_noisy, 0., 1.)

                preds = model(imgs_noisy)
                loss = loss_fn(preds, imgs)

                test_loss += loss.item()

        train_loss /= len(train_dataloader)
        test_loss /= len(test_dataloader)

        tqdm_dct = {'train loss:': train_loss, 'test loss:': test_loss}
        tqdm_iter.set_postfix(tqdm_dct, refresh=True)
        tqdm_iter.refresh()
```

```python
train(dataloaders, model, loss_fn, optimizer, epochs, device)
```

```python
model.eval()
predictions = []
plots = 5
for i, data in enumerate(test_dataset):
    if i == plots:
        break
    predictions.append(model(data[0].to(device).unsqueeze(0)).detach().cpu())
plotn(plots, test_dataset)
plotn(plots, predictions)
```

> **Task 1**: Try to train autoencoder with very small latent vector size, eg. 2, and plot the dots corresponding to different digits. *Hint: Use fully-connected dense layer after the convoluitonal part to reduce the vector size to the required value.*

> **Task 2**: Starting from different digits, obtain their latent space representations, and see what effect adding some noise to the latent space has on the resulting digits.

#### Denoising

Autoencoders can be effectively used to remove noise from images. In order to train denoiser, we will start with noise-free images, and add artificial noise to them. Then, we will feed autoencoder with noisy images as input, and noise-free images as output.

Let's see how this works for MNIST:

```python
plotn(5, train_dataset, noisy=True)
```

```python
model = AutoEncoder().to(device)
optimizer = optim.Adam(model.parameters(), lr=lr, eps=eps)
loss_fn = nn.BCELoss()
```

```python
noisy_tensor = torch.FloatTensor(noisify([256, 1, 28, 28])).to(device)
test_noisy_tensor = torch.FloatTensor(noisify([1, 1, 28, 28])).to(device)
noisy_tensors = (noisy_tensor, test_noisy_tensor)
```

```python
train(dataloaders, model, loss_fn, optimizer, 100, device, noisy=noisy_tensors)
```

```python
model.eval()
predictions = []
noise = []
plots = 5
for i, data in enumerate(test_dataset):
    if i == plots:
        break
    shapes = data[0].shape
    noisy_data = data[0] + test_noisy_tensor[0].detach().cpu()
    noise.append(noisy_data)
    predictions.append(model(noisy_data.to(device).unsqueeze(0)).detach().cpu())
plotn(plots, noise)
plotn(plots, predictions)
```

> **Exercise:** See how denoiser trained on MNIST digits works for different images. As an example, you can take [Fashion MNIST](https://pytorch.org/vision/stable/generated/torchvision.datasets.FashionMNIST.html#torchvision.datasets.FashionMNIST) dataset, which has the same image size. Note that denoiser works well only on the same image type that it was trained on (i.e. for the same probability distribution of input data).

#### Super-Resolution

Similarly to denoiser, we can train autoencoders to increase the resolution of the image. To train super-resolution network, we will start with high-resolution images, and automatically downscale them to produce network inputs. We will then feed autoencoder with small images as inputs and high-resolution images as outputs.

For that let's downscale image to 14x14 at train.

```python
super_res_koeff = 2.0
plotn(5, train_dataset, super_res=super_res_koeff)
```

```python
class SuperResolutionEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 16, kernel_size=(3, 3), padding='same')
        self.maxpool1 = nn.MaxPool2d(kernel_size=(2, 2))
        self.conv2 = nn.Conv2d(16, 8, kernel_size=(3, 3), padding='same')
        self.maxpool2 = nn.MaxPool2d(kernel_size=(2, 2), padding=(1, 1))
        self.relu = nn.ReLU()

    def forward(self, input):
        hidden1 = self.maxpool1(self.relu(self.conv1(input)))
        encoded = self.maxpool2(self.relu(self.conv2(hidden1)))
        return encoded
```

```python
model = AutoEncoder(super_resolution=True).to(device)
optimizer = optim.Adam(model.parameters(), lr=lr, eps=eps)
loss_fn = nn.BCELoss()
```

```python
train(dataloaders, model, loss_fn, optimizer, epochs, device, super_res=2.0)
```

```python
model.eval()
predictions = []
plots = 5
shapes = test_dataset[0][0].shape

for i, data in enumerate(test_dataset):
    if i == plots:
        break
    _transform = transforms.Resize((int(shapes[1] / super_res_koeff), int(shapes[2] / super_res_koeff)))
    predictions.append(model(_transform(data[0]).to(device).unsqueeze(0)).detach().cpu())
plotn(plots, test_dataset, super_res=super_res_koeff)
plotn(plots, predictions)
```

> **Exercise**: Try to train super-resolution network on [CIFAR-10](https://pytorch.org/vision/stable/generated/torchvision.datasets.CIFAR10.html) for 2x and 4x upscaling. Use noise as input to 4x upscaling model and observe the result.

Traditional autoencoders reduce the dimension of the input data somehow, figuring out the important features of input images. However, latent vectors often do not make much sense. In other words, taking MNIST dataset as an example, figuring out which digits correspond to different latent vectors is not an easy task, because close latent vectors would not necessarily correspond to the same digits. 

On the other hand, to train *generative* models it is better to have some understanding of the latent space. This idea leads us to **variational auto-encoder** (VAE).

VAE is the autoencoder that learns to predict *statistical distribution* of the latent parameters, so-called **latent distribution**. For example, we can assume that latent vectors would be distributed as $N(\mathrm{z\_mean},e^{\mathrm{z\_log}})$, where $\mathrm{z\_mean}, \mathrm{z\_log} \in\mathbb{R}^d$. Encoder in VAE learns to predict those parameters, and then decoder takes a random vector from this distribution to reconstruct the object.

To summarize:

 * From input vector, we predict `z_mean` and `z_log` (instead of predicting the standard deviation itself, we predict it's logarithm)
 * We sample a vector `sample(z_val in code)` from the distribution $N(\mathrm{z\_mean},e^{\mathrm{z\_log\_sigma}})$
 * Decoder tries to decode the original image using `sample` as an input vector

 <img src="images/vae.png" width="50%">

 > Image from [this blog post](https://ijdykeman.github.io/ml/2016/12/21/cvae.html) by Isaak Dykeman

```python
class VAEEncoder(nn.Module):
    def __init__(self, device):
        super().__init__()
        self.intermediate_dim = 512
        self.latent_dim = 2
        self.linear = nn.Linear(784, self.intermediate_dim)
        self.z_mean = nn.Linear(self.intermediate_dim, self.latent_dim)
        self.z_log = nn.Linear(self.intermediate_dim, self.latent_dim)
        self.relu = nn.ReLU()
        self.device = device

    def forward(self, input):
        bs = input.shape[0]

        hidden = self.relu(self.linear(input))
        z_mean = self.z_mean(hidden)
        z_log = self.z_log(hidden)

        eps = torch.FloatTensor(np.random.normal(size=(bs, self.latent_dim))).to(device)
        z_val = z_mean + torch.exp(z_log) * eps
        return z_mean, z_log, z_val
```

```python
class VAEDecoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.intermediate_dim = 512
        self.latent_dim = 2
        self.linear = nn.Linear(self.latent_dim, self.intermediate_dim)
        self.output = nn.Linear(self.intermediate_dim, 784)
        self.relu = nn.ReLU()
        self.sigmoid = nn.Sigmoid()

    def forward(self, input):
        hidden = self.relu(self.linear(input))
        decoded = self.sigmoid(self.output(hidden))
        return decoded
```

```python
class VAEAutoEncoder(nn.Module):
    def __init__(self, device):
        super().__init__()
        self.encoder = VAEEncoder(device)
        self.decoder = VAEDecoder()
        self.z_vals = None

    def forward(self, input):
        bs, c, h, w = input.shape[0], input.shape[1], input.shape[2], input.shape[3]
        input = input.view(bs, -1)
        encoded = self.encoder(input)
        self.z_vals = encoded
        decoded = self.decoder(encoded[2])
        return decoded
    
    def get_zvals(self):
        return self.z_vals
```

Variational auto-encoders use complex loss function that consists of two parts:
* **Reconstruction loss** is the loss function that shows how close reconstructed image is to the target (can be MSE). It is the same loss function as in normal autoencoders.
* **KL loss**, which ensures that latent variable distributions stays close to normal distribution. It is based on the notion of [Kullback-Leibler divergence](https://www.countbayesie.com/blog/2017/5/9/kullback-leibler-divergence-explained) - a metric to estimate how similar two statistical distributions are.

```python
def vae_loss(preds, targets, z_vals):
    mse = nn.MSELoss()
    reconstruction_loss = mse(preds, targets.view(targets.shape[0], -1)) * 784.0
    temp = 1.0 + z_vals[1] - torch.square(z_vals[0]) - torch.exp(z_vals[1])
    kl_loss = -0.5 * torch.sum(temp, axis=-1)
    return torch.mean(reconstruction_loss + kl_loss)
```

```python
model = VAEAutoEncoder(device).to(device)
optimizer = optim.RMSprop(model.parameters(), lr=lr, eps=eps)
```

```python
def train_vae(dataloaders, model, optimizer, epochs, device):
    tqdm_iter = tqdm(range(epochs))
    train_dataloader, test_dataloader = dataloaders[0], dataloaders[1]

    for epoch in tqdm_iter:
        model.train()
        train_loss = 0.0
        test_loss = 0.0

        for batch in train_dataloader:
            imgs, labels = batch
            imgs = imgs.to(device)
            labels = labels.to(device)

            preds = model(imgs)
            z_vals = model.get_zvals()
            loss = vae_loss(preds, imgs, z_vals)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        model.eval()
        with torch.no_grad():
            for batch in test_dataloader:
                imgs, labels = batch
                imgs = imgs.to(device)
                labels = labels.to(device)

                preds = model(imgs)
                z_vals = model.get_zvals()
                loss = vae_loss(preds, imgs, z_vals)

                test_loss += loss.item()

        train_loss /= len(train_dataloader)
        test_loss /= len(test_dataloader)

        tqdm_dct = {'train loss:': train_loss, 'test loss:': test_loss}
        tqdm_iter.set_postfix(tqdm_dct, refresh=True)
        tqdm_iter.refresh()
```

```python
train_vae(dataloaders, model, optimizer, epochs, device)
```

```python
model.eval()
predictions = []
plots = 5
for i, data in enumerate(test_dataset):
    if i == plots:
        break
    predictions.append(model(data[0].to(device).unsqueeze(0)).view(1, 28, 28).detach().cpu())
plotn(plots, test_dataset)
plotn(plots, predictions)
```

> **Task**: In our sample, we have trained fully-connected VAE. Now take the CNN from traditional auto-encoder above and create CNN-based VAE.

Adversarial Auto-Encoders is a **combination** of Generative Adversarial Networks and Variational Auto-Encoders. 

Encoder will be the generator, discriminator will learn to distinguish the real images encoder output from generated ones. Encoder output is a distribution, from this output decoder will try decode image.

In this approach we have **three loss functions**: generator loss, discriminator loss from GAN's and reconstruction loss from VAE.

 <img src="images/aae.png" width="50%">

 > Image from [this blog post](https://blog.paperspace.com/adversarial-autoencoders-with-pytorch/) by Felipe Ducau

```python
class AAEEncoder(nn.Module):
    def __init__(self, input_dim, inter_dim, latent_dim):
        super().__init__()
        self.linear1 = nn.Linear(input_dim, inter_dim)
        self.linear2 = nn.Linear(inter_dim, inter_dim)
        self.linear3 = nn.Linear(inter_dim, inter_dim)
        self.linear4 = nn.Linear(inter_dim, latent_dim)
        self.relu = nn.ReLU()
        
    def forward(self, input):
        hidden1 = self.relu(self.linear1(input))
        hidden2 = self.relu(self.linear2(hidden1))
        hidden3 = self.relu(self.linear3(hidden2))
        encoded = self.linear4(hidden3)
        return encoded
```

```python
class AAEDecoder(nn.Module):
    def __init__(self, latent_dim, inter_dim, output_dim):
        super().__init__()
        self.linear1 = nn.Linear(latent_dim, inter_dim)
        self.linear2 = nn.Linear(inter_dim, inter_dim)
        self.linear3 = nn.Linear(inter_dim, inter_dim)
        self.linear4 = nn.Linear(inter_dim, output_dim)
        self.relu = nn.ReLU()
        self.sigmoid = nn.Sigmoid()
        
    def forward(self, input):
        hidden1 = self.relu(self.linear1(input))
        hidden2 = self.relu(self.linear2(hidden1))
        hidden3 = self.relu(self.linear3(hidden2))
        decoded = self.sigmoid(self.linear4(hidden3))
        return decoded
```

```python
class AAEDiscriminator(nn.Module):
    def __init__(self, latent_dim, inter_dim):
        super().__init__()
        self.latent_dim = latent_dim
        self.inter_dim = inter_dim
        self.linear1 = nn.Linear(latent_dim, inter_dim)
        self.linear2 = nn.Linear(inter_dim, inter_dim)
        self.linear3 = nn.Linear(inter_dim, inter_dim)
        self.linear4 = nn.Linear(inter_dim, inter_dim)
        self.linear5 = nn.Linear(inter_dim, 1)
        self.relu = nn.ReLU()
        self.sigmoid = nn.Sigmoid()
        
    def forward(self, input):
        hidden1 = self.relu(self.linear1(input))
        hidden2 = self.relu(self.linear2(hidden1))
        hidden3 = self.relu(self.linear3(hidden2))
        hidden4 = self.relu(self.linear4(hidden3))
        decoded = self.sigmoid(self.linear4(hidden4))
        return decoded
    
    def get_dims(self):
        return self.latent_dim, self.inter_dim
        
```

```python
input_dims = 784
inter_dims = 1000
latent_dims = 150
```

```python
aae_encoder = AAEEncoder(input_dims, inter_dims, latent_dims).to(device)
aae_decoder = AAEDecoder(latent_dims, inter_dims, input_dims).to(device)
aae_discriminator = AAEDiscriminator(latent_dims, int(inter_dims / 2)).to(device)
```

```python
lr = 1e-4
regularization_lr = 5e-5
```

```python
optim_encoder = optim.Adam(aae_encoder.parameters(), lr=lr)
optim_encoder_regularization = optim.Adam(aae_encoder.parameters(), lr=regularization_lr)
optim_decoder = optim.Adam(aae_decoder.parameters(), lr=lr)
optim_discriminator = optim.Adam(aae_discriminator.parameters(), lr=regularization_lr)
```

```python
def train_aae(dataloaders, models, optimizers, epochs, device):
    tqdm_iter = tqdm(range(epochs))
    train_dataloader, test_dataloader = dataloaders[0], dataloaders[1]
    
    enc, dec, disc = models[0], models[1], models[2]
    optim_enc, optim_enc_reg, optim_dec, optim_disc = optimizers[0], optimizers[1], optimizers[2], optimizers[3]
    
    eps = 1e-9

    for epoch in tqdm_iter:
        enc.train()
        dec.train()
        disc.train()

        train_reconst_loss = 0.0
        train_disc_loss = 0.0
        train_enc_loss = 0.0
        
        test_reconst_loss = 0.0
        test_disc_loss = 0.0
        test_enc_loss = 0.0

        for batch in train_dataloader:
            imgs, labels = batch
            imgs = imgs.view(imgs.shape[0], -1).to(device)
            labels = labels.to(device)
            
            enc.zero_grad()
            dec.zero_grad()
            disc.zero_grad()
             
            encoded = enc(imgs)
            decoded = dec(encoded)
            
            reconstruction_loss = F.binary_cross_entropy(decoded, imgs)
            reconstruction_loss.backward()
            
            optim_enc.step()
            optim_dec.step()
            enc.eval()

            latent_dim, disc_inter_dim = disc.get_dims()
            real = torch.randn(imgs.shape[0], latent_dim).to(device)
            
            disc_real = disc(real)
            disc_fake = disc(enc(imgs))
            
            disc_loss = -torch.mean(torch.log(disc_real + eps) + torch.log(1.0 - disc_fake + eps))
            disc_loss.backward()
            
            optim_dec.step()
            enc.train()
            
            disc_fake = disc(enc(imgs))
            enc_loss = -torch.mean(torch.log(disc_fake + eps))
            enc_loss.backward()
            
            optim_enc_reg.step()

            train_reconst_loss += reconstruction_loss.item()
            train_disc_loss += disc_loss.item()
            train_enc_loss += enc_loss.item()

        enc.eval()
        dec.eval()
        disc.eval()

        with torch.no_grad():
            for batch in test_dataloader:
                imgs, labels = batch
                imgs = imgs.view(imgs.shape[0], -1).to(device)
                labels = labels.to(device)

                encoded = enc(imgs)
                decoded = dec(encoded)

                reconstruction_loss = F.binary_cross_entropy(decoded, imgs)

                latent_dim, disc_inter_dim = disc.get_dims()
                real = torch.randn(imgs.shape[0], latent_dim).to(device)

                disc_real = disc(real)
                disc_fake = disc(enc(imgs))
                disc_loss = -torch.mean(torch.log(disc_real + eps) + torch.log(1.0 - disc_fake + eps))

                disc_fake = disc(enc(imgs))
                enc_loss = -torch.mean(torch.log(disc_fake + eps))

                test_reconst_loss += reconstruction_loss.item()
                test_disc_loss += disc_loss.item()
                test_enc_loss += enc_loss.item()

        train_reconst_loss /= len(train_dataloader)
        train_disc_loss /= len(train_dataloader)
        train_enc_loss /= len(train_dataloader)
        
        test_reconst_loss /= len(test_dataloader)
        test_disc_loss /= len(test_dataloader)
        test_enc_loss /= len(test_dataloader)

        tqdm_dct = {'train reconst loss:': train_reconst_loss, 'train disc loss:': train_disc_loss, 'train enc loss': train_enc_loss, \
                        'test reconst loss:': test_reconst_loss, 'test disc loss:': test_disc_loss, 'test enc loss': test_enc_loss}
        tqdm_iter.set_postfix(tqdm_dct, refresh=True)
        tqdm_iter.refresh()
```

```python
models = (aae_encoder, aae_decoder, aae_discriminator)
optimizers = (optim_encoder, optim_encoder_regularization, optim_decoder, optim_discriminator)
```

```python
train_aae(dataloaders, models, optimizers, epochs, device)
```

```python
aae_encoder.eval()
aae_decoder.eval()
predictions = []
plots = 10
for i, data in enumerate(test_dataset):
    if i == plots:
        break
    pred = aae_decoder(aae_encoder(data[0].to(device).unsqueeze(0).view(1, 784)))
    predictions.append(pred.view(1, 28, 28).detach().cpu())
plotn(plots, test_dataset)
plotn(plots, predictions)
```

#### Additional Materials

* [Blog post on NeuroHive](https://neurohive.io/ru/osnovy-data-science/variacionnyj-avtojenkoder-vae/)
* [Variational Autoencoders Explained](https://kvfrans.com/variational-autoencoders-explained/)

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/09-Autoencoders/AutoencodersTF.ipynb`）:

When training CNNs, one of the problems is that we need a lot of labeled data. In the case of image classification, we need to separate images into different classes, which is a manual effort.

However, we might want to use raw (unlabeled) data for training CNN feature extractors, which is called **self-supervised learning**. Instead of labels, we will use training images as both network input and output. The main idea of **autoencoder** is that we will have an **encoder network** that converts input image into some **latent space** (normally it is just a vector of some smaller size), then the **decoder network**, whose goal would be to reconstruct the original image.

Since we are training autoencoder to capture as much of the information from the original image as possible for accurate reconstruction, the network tries to find the best **embedding** of input images to capture the meaning.

![AutoEncoder Diagram](images/autoencoder_schema.jpg)

*Image from [Keras blog](https://blog.keras.io/building-autoencoders-in-keras.html)*

Most of the examples below are inspired by [this article](https://blog.keras.io/building-autoencoders-in-keras.html).

Let's create simplest autoencoder for MNIST:

```python
import tensorflow as tf
from tensorflow.keras.datasets import mnist
import numpy as np
import matplotlib.pyplot as plt

(x_train, y_trainclass), (x_test, y_testclass) = mnist.load_data()
```

```python
def plotn(n,x):
  fig,ax = plt.subplots(1,n)
  for i,z in enumerate(x[0:n]):
    ax[i].imshow(z.reshape(28,28) if z.size==28*28 else z.reshape(14,14) if z.size==14*14 else z)
  plt.show()
  
plotn(5,x_train)
```

```python
from tensorflow.keras.layers import Input, Dense, Conv2D, MaxPooling2D, UpSampling2D, Lambda
from tensorflow.keras.models import Model
from tensorflow.keras.losses import binary_crossentropy,mse

input_img = Input(shape=(28, 28, 1))

x = Conv2D(16, (3, 3), activation='relu', padding='same')(input_img)
x = MaxPooling2D((2, 2), padding='same')(x)
x = Conv2D(8, (3, 3), activation='relu', padding='same')(x)
x = MaxPooling2D((2, 2), padding='same')(x)
x = Conv2D(8, (3, 3), activation='relu', padding='same')(x)
encoded = MaxPooling2D((2, 2), padding='same')(x)

encoder = Model(input_img,encoded)

input_rep = Input(shape=(4,4,8))

x = Conv2D(8, (3, 3), activation='relu', padding='same')(input_rep)
x = UpSampling2D((2, 2))(x)
x = Conv2D(8, (3, 3), activation='relu', padding='same')(x)
x = UpSampling2D((2, 2))(x)
x = Conv2D(16, (3, 3), activation='relu')(x)
x = UpSampling2D((2, 2))(x)
decoded = Conv2D(1, (3, 3), activation='sigmoid', padding='same')(x)

decoder = Model(input_rep,decoded)

autoencoder = Model(input_img, decoder(encoder(input_img)))
autoencoder.compile(optimizer='adam', loss='binary_crossentropy')
```

```python
x_train = x_train.astype('float32') / 255.
x_test = x_test.astype('float32') / 255.
x_train = np.reshape(x_train, (len(x_train), 28, 28, 1))
x_test = np.reshape(x_test, (len(x_test), 28, 28, 1))
```

```python
autoencoder.fit(x_train, x_train,
                epochs=25,
                batch_size=128,
                shuffle=True,
                validation_data=(x_test, x_test))
```

```python
y_test = autoencoder.predict(x_test[0:5])
plotn(5,x_test)
plotn(5,y_test)
```

```python
encoder = Model(input_img, encoded)
encoded_imgs = encoder.predict(x_test[0:5])
```

```python
plotn(5,encoded_imgs.reshape(5,-1,8))
```

```python
print(encoded_imgs.max(),encoded_imgs.min())
res = decoder.predict(7*np.random.rand(7,4,4,8))
plotn(7,res)
```

> **Task 1**: Try to train autoencoder with very small latent vector size, eg. 2, and plot the dots corresponding to different digits. *Hint: Use fully-connected dense layer after the convoluitonal part to reduce the vector size to the required value.*

> **Task 2**: Starting from different digits, obtain their latent space representations, and see what effect adding some noise to the latent space has on the resulting digits.

#### Denoising

Autoencoders can be effectively used to remove noise from images. In order to train denoiser, we will start with noise-free images, and add artificial noise to them. Then, we will feed autoencoder with noisy images as input, and noise-free images as output.

Let's see how this works for MNIST:

```python
def noisify(data):
  return np.clip(data+np.random.normal(loc=0.5,scale=0.5,size=data.shape),0.,1.)

x_train_noise = noisify(x_train)
x_test_noise = noisify(x_test)

plotn(5,x_train_noise)
```

```python
autoencoder.fit(x_train_noise, x_train,
                epochs=25,
                batch_size=128,
                shuffle=True,
                validation_data=(x_test_noise, x_test))
```

```python
y_test = autoencoder.predict(x_test_noise[0:5])
plotn(5,x_test_noise)
plotn(5,y_test)
```

> **Exercise:** See how denoiser trained on MNIST digits works for different images. As an example, you can take [Fashion MNIST](https://keras.io/api/datasets/fashion_mnist/) dataset, which has the same image size. Note that denoiser works well only on the same image type that it was trained on (i.e. for the same probability distribution of input data).

#### Super-resolution

Similarly to denoiser, we can train autoencoders to increase the resolution of the image. To train super-resolution network, we will start with high-resolution images, and automatically downscale them to produce network inputs. We will then feed autoencoder with small images as inputs and high-res images as outputs.

Let's downscale MNIST to 14x14:

```python
x_train_lr = tf.keras.layers.AveragePooling2D()(x_train).numpy()
x_test_lr = tf.keras.layers.AveragePooling2D()(x_test).numpy()
plotn(5,x_train_lr)
```

```python
from tensorflow.keras.layers import Input, Dense, Conv2D, MaxPooling2D, UpSampling2D, Lambda
from tensorflow.keras.models import Model
from tensorflow.keras.losses import binary_crossentropy,mse

input_img = Input(shape=(14, 14, 1))

x = Conv2D(16, (3, 3), activation='relu', padding='same')(input_img)
x = MaxPooling2D((2, 2), padding='same')(x)
x = Conv2D(8, (3, 3), activation='relu', padding='same')(x)
encoded = MaxPooling2D((2, 2), padding='same')(x)

encoder = Model(input_img,encoded)

input_rep = Input(shape=(4,4,8))

x = Conv2D(8, (3, 3), activation='relu', padding='same')(input_rep)
x = UpSampling2D((2, 2))(x)
x = Conv2D(8, (3, 3), activation='relu', padding='same')(x)
x = UpSampling2D((2, 2))(x)
x = Conv2D(16, (3, 3), activation='relu')(x)
x = UpSampling2D((2, 2))(x)
decoded = Conv2D(1, (3, 3), activation='sigmoid', padding='same')(x)

decoder = Model(input_rep,decoded)

autoencoder = Model(input_img, decoder(encoder(input_img)))
autoencoder.compile(optimizer='adam', loss='binary_crossentropy')
```

```python
autoencoder.fit(x_train_lr, x_train,
                epochs=25,
                batch_size=128,
                shuffle=True,
                validation_data=(x_test_lr, x_test))
```

```python
y_test_lr = autoencoder.predict(x_test_lr[0:5])
plotn(5,x_test_lr)
plotn(5,y_test_lr)
```

> **Exercise**: Try to train super-resolution network on [CIFAR-10](https://keras.io/api/datasets/cifar10/) for 2x and 4x upscaling. Use noise as input to 4x upscaling model and observe the result.

#### Variational Auto-Encoders (VAE)

Traditional autoencoders reduce the dimension of the input data somehow, figuring out the important features of input images. However, latent vectors often do not make much sense. In other words, taking MNIST dataset as an example, figuring out which digits correspond to different latent vectors is not an easy task, because close latent vectors would not necessarily correspond to the same digits. 

On the other hand, to train *generative* models it is better to have some understanding of the latent space. This idea leads us to **variational auto-encoder** (VAE).

VAE is the autoencoder that learns to predict *statistical distribution* of the latent parameters, so-called **latent distribution**. For example, we can assume that latent vectors would be distributed as $N(\mathrm{z\_mean},e^{\mathrm{z\_log\_sigma}})$, where $\mathrm{z\_mean}, \mathrm{z\_log\_sigma} \in\mathbb{R}^d$. Encoder in VAE learns to predict those parameters, and then decoder takes a random vector from this distribution to reconstruct the object.

To summarize:

 * From input vector, we predict `z_mean` and `z_log_sigma` (instead of predicting the standard deviation itself, we predict it's logarithm)
 * We sample a vector `sample` from the distribution $N(\mathrm{z\_mean},e^{\mathrm{z\_log\_sigma}})$
 * Decoder tries to decode the original image using `sample` as an input vector

 <img src="images/vae.png" width="50%">

```python
intermediate_dim = 512
latent_dim = 2
batch_size = 128

tf.compat.v1.disable_eager_execution()

inputs = Input(shape=(784,))
h = Dense(intermediate_dim, activation='relu')(inputs)
z_mean = Dense(latent_dim)(h)
z_log_sigma = Dense(latent_dim)(h)
```

```python
@tf.function
def sampling(args):
    z_mean, z_log_sigma = args
    bs = tf.shape(z_mean)[0]
    epsilon = tf.random.normal(shape=(bs, latent_dim))
    return z_mean + tf.exp(z_log_sigma) * epsilon

z = Lambda(sampling)([z_mean, z_log_sigma])
```

```python
encoder = Model(inputs, [z_mean, z_log_sigma, z])

latent_inputs = Input(shape=(latent_dim,))
x = Dense(intermediate_dim, activation='relu')(latent_inputs)
outputs = Dense(784, activation='sigmoid')(x)

decoder = Model(latent_inputs, outputs)

outputs = decoder(encoder(inputs)[2])

vae = Model(inputs, outputs)
```

Variational auto-encoders use complex loss function that consists of two parts:
* **Reconstruction loss** is the loss function that shows how close reconstructed image is to the target (can be MSE). It is the same loss function as in normal autoencoders.
* **KL loss**, which ensures that latent variable distributions stays close to normal distribution. It is based on the notion of [Kullback-Leibler divergence](https://www.countbayesie.com/blog/2017/5/9/kullback-leibler-divergence-explained) - a metric to estimate how similar two statistical distributions are.

```python
@tf.function
def vae_loss(x1,x2):
  reconstruction_loss = mse(x1,x2)*784
  tmp = 1 + z_log_sigma - tf.square(z_mean) - tf.exp(z_log_sigma)
  kl_loss = -0.5*tf.reduce_sum(tmp, axis=-1)
  return tf.convert_to_tensor(tf.reduce_mean(reconstruction_loss + kl_loss))

vae.compile(optimizer='rmsprop', loss=vae_loss)
```

```python
x_train_flat = x_train.reshape((len(x_train), np.prod(x_train.shape[1:])))
x_test_flat = x_test.reshape((len(x_test), np.prod(x_test.shape[1:])))

vae.fit(x_train_flat, x_train_flat,
        shuffle=True,
        epochs=25,
        batch_size=batch_size,
        validation_data=(x_test_flat, x_test_flat))
```

```python
y_test = vae.predict(x_test_flat[0:5])
plotn(5,x_test_flat)
plotn(5,y_test)
```

```python
x_test_encoded = encoder.predict(x_test_flat)[0]
plt.figure(figsize=(6, 6))
plt.scatter(x_test_encoded[:, 0], x_test_encoded[:, 1], c=y_testclass)
plt.colorbar()
plt.show()
```

```python
def plotsample(n):
  dx = np.linspace(-1,1,n)
  dy = np.linspace(-1,1,n)
  fig,ax = plt.subplots(n,n)
  for i,xi in enumerate(dx):
    for j,xj in enumerate(dy):
      res = decoder.predict(np.array([xi,xj]).reshape(-1,2))[0]
      ax[i,j].imshow(res.reshape(28,28))
      ax[i,j].axis('off')
  plt.show()
  
plotsample(10)
```

> **Task**: In our sample, we have trained fully-connected VAE. Now take the CNN from traditional auto-encoder above and create CNN-based VAE.

#### Additional Materials

* [Blog post on NeuroHive](https://neurohive.io/ru/osnovy-data-science/variacionnyj-avtojenkoder-vae/)
* [Variational Autoencoders Explained](https://kvfrans.com/variational-autoencoders-explained/)

### Autoencoders

When training CNNs, one of the problems is that we need a lot of labeled data. In the case of image classification, we need to separate images into different classes, which is a manual effort.

However, we might want to use raw (unlabeled) data for training CNN feature extractors, which is called **self-supervised learning**. Instead of labels, we will use training images as both network input and output. The main idea of **autoencoder** is that we will have an **encoder network** that converts input image into some **latent space** (normally it is just a vector of some smaller size), then the **decoder network**, whose goal would be to reconstruct the original image.

> ✅ An [autoencoder](https://wikipedia.org/wiki/Autoencoder) is "a type of artificial neural network used to learn efficient codings of unlabeled data."

Since we are training an autoencoder to capture as much of the information from the original image as possible for accurate reconstruction, the network tries to find the best **embedding** of input images to capture the meaning.л.

![AutoEncoder Diagram](images/autoencoder_schema.jpg)

> Image from [Keras blog](https://blog.keras.io/building-autoencoders-in-keras.html)

#### Scenarios for using Autoencoders

While reconstructing original images does not seem useful in its own right, there are a few scenarios where autoencoders are especially useful:

* **Lowering the dimension of images for visualization** or **training image embeddings**. Usually autoencoders give better results than PCA, because it takes into account spatial nature of images and hierarchical features.
* **Denoising**, i.e. removing noise from the image. Because noise carries out a lot of useless information, autoencoder cannot fit it all into relatively small latent space, and thus it captures only important part of the image. When training denoisers, we start with original images, and use images with artificially added noise as input for autoencoder.
* **Super-resolution**, increasing image resolution. We start with high-resolution images, and use the image with lower resolution as the autoencoder input.
* **Generative models**. Once we train the autoencoder, the decoder part can be used to create new objects starting from random latent vectors.

#### Variational Autoencoders (VAE)

Traditional autoencoders reduce the dimension of the input data somehow, figuring out the important features of input images. However, latent vectors ofter do not make much sense. In other words, taking MNIST dataset as an example, figuring out which digits correspond to different latent vectors is not an easy task, because close latent vectors would not necessarily correspond to the same digits.

On the other hand, to train *generative* models it is better to have some understanding of the latent space. This idea leads us to **variational auto-encoder** (VAE).

VAE is the autoencoder that learns to predict *statistical distribution* of the latent parameters, so-called **latent distribution**. For example, we may want latent vectors to be distributed normally with some mean z<sub>mean</sub> and standard deviation z<sub>sigma</sub> (both mean and standard deviation are vectors of some dimensionality d). Encoder in VAE learns to predict those parameters, and then decoder takes a random vector from this distribution to reconstruct the object.

To summarize:

 * From input vector, we predict `z_mean` and `z_log_sigma` (instead of predicting the standard deviation itself, we predict its logarithm)
 * We sample a vector `sample` from the distribution N(z<sub>mean</sub>,exp(z<sub>log\_sigma</sub>))
 * The decoder tries to decode the original image using `sample` as an input vector

 <img src="images/vae.png" width="50%">

> Image from [this blog post](https://ijdykeman.github.io/ml/2016/12/21/cvae.html) by Isaak Dykeman

Variational auto-encoders use a complex loss function that consists of two parts:

* **Reconstruction loss** is the loss function that shows how close a reconstructed image is to the target (it can be Mean Squared Error, or MSE). It is the same loss function as in normal autoencoders.
* **KL loss**, which ensures that latent variable distributions stays close to normal distribution. It is based on the notion of [Kullback-Leibler divergence](https://www.countbayesie.com/blog/2017/5/9/kullback-leibler-divergence-explained) - a metric to estimate how similar two statistical distributions are.

One important advantage of VAEs is that they allow us to generate new images relatively easily, because we know which distribution from which to sample latent vectors. For example, if we train VAE with 2D latent vector on MNIST, we can then vary components of the latent vector to get different digits:

<img alt="vaemnist" src="images/vaemnist.png" width="50%"/>

> Image by [Dmitry Soshnikov](http://soshnikov.com)

Observe how images blend into each other, as we start getting latent vectors from the different portions of the latent parameter space. We can also visualize this space in 2D:

<img alt="vaemnist cluster" src="images/vaemnist-diag.png" width="50%"/> 

> Image by [Dmitry Soshnikov](http://soshnikov.com)

#### ✍️ Exercises: Autoencoders

Learn more about autoencoders in these corresponding notebooks:

* [Autoencoders in TensorFlow](AutoencodersTF.ipynb)
* [Autoencoders in PyTorch](AutoEncodersPyTorch.ipynb)

#### Properties of Autoencoders

* **Data Specific** - they only work well with the type of images they have been trained on. For example, if we train a super-resolution network on flowers, it will not work well on portraits. This is because the network can produce higher resolution image by taking fine details from features learned from the training dataset.
* **Lossy** - the reconstructed image is not the same as the original image. The nature of loss is defined by the *loss function* used during training
* Works on **unlabeled data**

#### Conclusion

In this lesson, you learned about the various types of autoencoders available to the AI scientist. You learned how to build them, and how to use them to reconstruct images. You also learned about the VAE and how to use it to generate new images.

#### 🚀 Challenge

In this lesson, you learned about using autoencoders for images. But they can also be used for music! Check out the Magenta project's [MusicVAE](https://magenta.tensorflow.org/music-vae) project, which uses autoencoders to learn to reconstruct music. Do some [experiments](https://colab.research.google.com/github/magenta/magenta-demos/blob/master/colab-notebooks/Multitrack_MusicVAE.ipynb) with this library to see what you can create.

#### Review & Self Study

For reference, read more about autoencoders in these resources:

* [Building Autoencoders in Keras](https://blog.keras.io/building-autoencoders-in-keras.html)
* [Blog post on NeuroHive](https://neurohive.io/ru/osnovy-data-science/variacionnyj-avtojenkoder-vae/)
* [Variational Autoencoders Explained](https://kvfrans.com/variational-autoencoders-explained/)
* [Conditional Variational Autoencoders](https://ijdykeman.github.io/ml/2016/12/21/cvae.html)

#### Assignment

At the end of [this notebook using TensorFlow](AutoencodersTF.ipynb), you will find a 'task' - use this as your assignment.

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/10-GANs/GANPyTorch.ipynb`）:

The main goal of **Generative Adversarial Network** (GAN) is to generate images that are similar (but not identical) to training dataset.

GAN consists of two neural networks that are trained against each other:

 * **Generator** takes a random vector, and should generate an image from it
 * **Discriminator** is a networks that should distinguish between original image (from training dataset), and the one generated by the generator.

<img src="./images/gan_architecture.png" width="70%"/>

```python
import torch
import torchvision
import matplotlib.pyplot as plt
from torchvision import transforms
from torch import nn
from torch import optim
from tqdm import tqdm
import numpy as np
import torch.nn.functional as F
torch.manual_seed(42)
np.random.seed(42)
```

```python
device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
train_size = 1.0
lr = 2e-4
weight_decay = 8e-9
beta1 = 0.5
beta2 = 0.999
batch_size = 256
epochs = 100
plot_every = 10
```

#### Generator

The role of a generator is to take a random vector of some size (it is similar to latent vector in autoencoders) and generate the target image. It is very similar to the generative side of autoencoder.

In our example, we will use linear neural networks and MNIST dataset.

```python
class Generator(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear1 = nn.Linear(100, 256)
        self.bn1 = nn.BatchNorm1d(256, momentum=0.2)
        self.linear2 = nn.Linear(256, 512)
        self.bn2 = nn.BatchNorm1d(512, momentum=0.2)
        self.linear3 = nn.Linear(512, 1024)
        self.bn3 = nn.BatchNorm1d(1024, momentum=0.2)
        self.linear4 = nn.Linear(1024, 784)
        self.tanh = nn.Tanh()
        self.leaky_relu = nn.LeakyReLU(0.2)

    def forward(self, input):
        hidden1 = self.leaky_relu(self.bn1(self.linear1(input)))
        hidden2 = self.leaky_relu(self.bn2(self.linear2(hidden1)))
        hidden3 = self.leaky_relu(self.bn3(self.linear3(hidden2)))
        generated = self.tanh(self.linear4(hidden3)).view(input.shape[0], 1, 28, 28)
        return generated
```

A few tricks used in generator:
* Instead of ReLU, we use **LeakyReLU**, i.e. a ReLU which is not exactly 0 for negative $x$, but rather another linear function with very small slope.
* We use **BatchNorm1D** in order to stabilize training
* The activation function on last layer is **Tanh**, so the output is in the range [-1,1].

#### Discriminator

Discriminator is a classical image classification network. In our first example, we will also use linear classifier.

```python
class Discriminator(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear1 = nn.Linear(784, 512)
        self.linear2 = nn.Linear(512, 256)
        self.linear3 = nn.Linear(256, 1)
        self.leaky_relu = nn.LeakyReLU(0.2)
        self.sigmoid = nn.Sigmoid()

    def forward(self, input):
        input = input.view(input.shape[0], -1)
        hidden1 = self.leaky_relu(self.linear1(input))
        hidden2 = self.leaky_relu(self.linear2(hidden1))
        classififed = self.sigmoid(self.linear3(hidden2))
        return classififed
```

#### Loading dataset

We will use MNIST dataset.

```python
def mnist(train_part, transform=None):
    dataset = torchvision.datasets.MNIST('.', download=True, transform=transform)
    train_part = int(train_part * len(dataset))
    train_dataset, test_dataset = torch.utils.data.random_split(dataset, [train_part, len(dataset) - train_part])
    return train_dataset, test_dataset
```

```python
transform = transforms.Compose([
                                transforms.ToTensor(),
                                transforms.Normalize(mean=0.5, std=0.5)
])
```

```python
train_dataset, test_dataset = mnist(train_size, transform)
```

```python
train_dataloader = torch.utils.data.DataLoader(train_dataset, drop_last=True, batch_size=batch_size, shuffle=True)
dataloaders = (train_dataloader, )
```

#### Network training

On each step of the training, we have **two** phases:

* **Generator** training. We generate some random vectors **noise** (training happens in minibatches, so we use 100 vectors at a time), generate **true labels** (vector with shape (bs, 1) with 1.0 values), calculate generator loss between output from **frozen** discriminator with noise as input and true labels.

* **Discriminator** training. We calculate discriminator loss from **two** parts, **first** part is loss between output from discriminator with noise as input and **fake labels** (vector with shape (bs, 1) with 0.0 values), **second** part is loss between output from discriminator with real images as input and true labels (vector with shape (bs, 1) with 1.0 values). **Result loss** is (first_part_loss + second_part_loss) / 2.

```python
def plotn(n, generator, device):
    generator.eval()
    noise = torch.FloatTensor(np.random.normal(0, 1, (n, 100))).to(device)
    imgs = generator(noise).detach().cpu()
    fig, ax = plt.subplots(1, n)
    for i, im in enumerate(imgs):
        ax[i].imshow(im[0])
    plt.show()
```

```python
def train_gan(dataloaders, models, optimizers, loss_fn, epochs, plot_every, device):
    tqdm_iter = tqdm(range(epochs))
    train_dataloader = dataloaders[0]
    
    gen, disc = models[0], models[1]
    optim_gen, optim_disc = optimizers[0], optimizers[1]

    for epoch in tqdm_iter:
        gen.train()
        disc.train()

        train_gen_loss = 0.0
        train_disc_loss = 0.0
        
        test_gen_loss = 0.0
        test_disc_loss = 0.0

        for batch in train_dataloader:
            imgs, _ = batch
            imgs = imgs.to(device)

            disc.eval()
            gen.zero_grad()

            noise = torch.FloatTensor(np.random.normal(0.0, 1.0, (imgs.shape[0], 100))).to(device)
            real_labels = torch.ones((imgs.shape[0], 1)).to(device)
            fake_labels = torch.zeros((imgs.shape[0], 1)).to(device)
            
            generated = gen(noise)
            disc_preds = disc(generated)

            g_loss = loss_fn(disc_preds, real_labels)
            g_loss.backward()
            optim_gen.step()

            disc.train()
            disc.zero_grad()

            disc_real = disc(imgs)
            disc_real_loss = loss_fn(disc_real, real_labels)

            disc_fake = disc(generated.detach())
            disc_fake_loss = loss_fn(disc_fake, fake_labels)

            d_loss = (disc_real_loss + disc_fake_loss) / 2.0
            d_loss.backward()
            optim_disc.step()

            train_gen_loss += g_loss.item()
            train_disc_loss += d_loss.item()

        train_gen_loss /= len(train_dataloader)
        train_disc_loss /= len(train_dataloader)

        if epoch % plot_every == 0 or epoch == epochs - 1:
            plotn(5, gen, device)

        tqdm_dct = {'generator loss:': train_gen_loss, 'discriminator loss:': train_disc_loss}
        tqdm_iter.set_postfix(tqdm_dct, refresh=True)
        tqdm_iter.refresh()
```

```python
generator = Generator().to(device)
discriminator = Discriminator().to(device)
optimizer_generator = optim.Adam(generator.parameters(), lr=lr, weight_decay=weight_decay, betas=(beta1, beta2))
optimizer_discriminator = optim.Adam(discriminator.parameters(), lr=lr, weight_decay=weight_decay, betas=(beta1, beta2))
loss_fn = nn.BCELoss()

models = (generator, discriminator)
optimizers = (optimizer_generator, optimizer_discriminator)
```

```python
train_gan(dataloaders, models, optimizers, loss_fn, epochs, plot_every, device)
```

#### DCGAN

**Deep Convolutional GAN** is pretty obvious idea of using convolutional layers for generator and discriminator. The main difference here is using **Conv2DTranspose** layer in the generator.

<img src="images/dcgan_generator.png" width="60%"/>

> Image from [this tutorial](https://pytorch.org/tutorials/beginner/dcgan_faces_tutorial.html)

```python
class DCGenerator(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.ConvTranspose2d(100, 256, kernel_size=(3, 3), stride=(2, 2), bias=False)
        self.bn1 = nn.BatchNorm2d(256)
        self.conv2 = nn.ConvTranspose2d(256, 128, kernel_size=(3, 3), stride=(2, 2), bias=False)
        self.bn2 = nn.BatchNorm2d(128)
        self.conv3 = nn.ConvTranspose2d(128, 64, kernel_size=(3, 3), stride=(2, 2), bias=False)
        self.bn3 = nn.BatchNorm2d(64)
        self.conv4 = nn.ConvTranspose2d(64, 1, kernel_size=(3, 3), stride=(2, 2), padding=(2, 2), output_padding=(1, 1), bias=False)
        self.tanh = nn.Tanh()
        self.relu = nn.ReLU()

    def forward(self, input):
        hidden1 = self.relu(self.bn1(self.conv1(input)))
        hidden2 = self.relu(self.bn2(self.conv2(hidden1)))
        hidden3 = self.relu(self.bn3(self.conv3(hidden2)))
        generated = self.tanh(self.conv4(hidden3)).view(input.shape[0], 1, 28, 28)
        return generated
```

```python
class DCDiscriminator(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 64, kernel_size=(4, 4), stride=(2, 2), padding=(1, 1), bias=False)
        self.conv2 = nn.Conv2d(64, 128, kernel_size=(4, 4), stride=(2, 2), padding=(1, 1), bias=False)
        self.bn2 = nn.BatchNorm2d(128)
        self.conv3 = nn.Conv2d(128, 256, kernel_size=(4, 4), stride=(2, 2), padding=(1, 1), bias=False)
        self.bn3 = nn.BatchNorm2d(256)
        self.conv4 = nn.Conv2d(256, 1, kernel_size=(4, 4), stride=(2, 2), padding=(1, 1), bias=False)
        self.leaky_relu = nn.LeakyReLU(0.2)
        self.sigmoid = nn.Sigmoid()

    def forward(self, input):
        hidden1 = self.leaky_relu(self.conv1(input))
        hidden2 = self.leaky_relu(self.bn2(self.conv2(hidden1)))
        hidden3 = self.leaky_relu(self.bn3(self.conv3(hidden2)))
        classified = self.sigmoid(self.conv4(hidden3)).view(input.shape[0], -1)
        return classified
```

Weights initialization from [DCGAN](https://arxiv.org/pdf/1511.06434.pdf) paper.

```python
def weights_init(model):
    classname = model.__class__.__name__
    if classname.find('Conv') != -1:
        nn.init.normal_(model.weight.data, 0.0, 0.02)
    elif classname.find('BatchNorm') != -1:
        nn.init.normal_(model.weight.data, 1.0, 0.02)
        nn.init.constant_(model.bias.data, 0)
```

```python
transform = transforms.Compose([
                                transforms.ToTensor(),
])
```

```python
train_dataset, test_dataset = mnist(train_size, transform)
train_dataloader = torch.utils.data.DataLoader(train_dataset, drop_last=True, batch_size=batch_size, shuffle=True)
dataloaders = (train_dataloader, )
```

```python
generator = DCGenerator().to(device)
generator.apply(weights_init)
discriminator = DCDiscriminator().to(device)
discriminator.apply(weights_init)
optimizer_generator = optim.Adam(generator.parameters(), lr=lr, weight_decay=weight_decay, betas=(beta1, beta2))
optimizer_discriminator = optim.Adam(discriminator.parameters(), lr=lr, weight_decay=weight_decay, betas=(beta1, beta2))
loss_fn = nn.BCELoss()

models = (generator, discriminator)
optimizers = (optimizer_generator, optimizer_discriminator)
```

```python
def dcplotn(n, generator, device):
    generator.eval()
    noise = torch.FloatTensor(np.random.normal(0, 1, (n, 100, 1, 1))).to(device)
    imgs = generator(noise).detach().cpu()
    fig, ax = plt.subplots(1, n)
    for i, im in enumerate(imgs):
        ax[i].imshow(im[0])
    plt.show()
```

```python
def train_dcgan(dataloaders, models, optimizers, loss_fn, epochs, plot_every, device):
    tqdm_iter = tqdm(range(epochs))
    train_dataloader = dataloaders[0]
    
    gen, disc = models[0], models[1]
    optim_gen, optim_disc = optimizers[0], optimizers[1]
    
    gen.train()
    disc.train()

    for epoch in tqdm_iter:
        train_gen_loss = 0.0
        train_disc_loss = 0.0
        
        test_gen_loss = 0.0
        test_disc_loss = 0.0

        for batch in train_dataloader:
            imgs, _ = batch
            imgs = imgs.to(device)
            imgs = 2.0 * imgs - 1.0

            gen.zero_grad()

            noise = torch.FloatTensor(np.random.normal(0.0, 1.0, (imgs.shape[0], 100, 1, 1))).to(device)
            real_labels = torch.ones((imgs.shape[0], 1)).to(device)
            fake_labels = torch.zeros((imgs.shape[0], 1)).to(device)
            
            generated = gen(noise)
            disc_preds = disc(generated)

            g_loss = loss_fn(disc_preds, real_labels)
            g_loss.backward()
            optim_gen.step()

            disc.zero_grad()

            disc_real = disc(imgs)
            disc_real_loss = loss_fn(disc_real, real_labels)

            disc_fake = disc(generated.detach())
            disc_fake_loss = loss_fn(disc_fake, fake_labels)

            d_loss = (disc_real_loss + disc_fake_loss) / 2.0
            d_loss.backward()
            optim_disc.step()

            train_gen_loss += g_loss.item()
            train_disc_loss += d_loss.item()

        train_gen_loss /= len(train_dataloader)
        train_disc_loss /= len(train_dataloader)

        if epoch % plot_every == 0 or epoch == epochs - 1:
            dcplotn(5, gen, device)

        tqdm_dct = {'generator loss:': train_gen_loss, 'discriminator loss:': train_disc_loss}
        tqdm_iter.set_postfix(tqdm_dct, refresh=True)
        tqdm_iter.refresh()
```

```python
train_dcgan(dataloaders, models, optimizers, loss_fn, epochs // 2, plot_every // 2, device)
```

```python
generator.eval()
dcplotn(5, generator, device)
```

> **Task**: Try generating more complex color images with DCGAN - for example, take one class from [CIFAR-10](https://pytorch.org/vision/stable/generated/torchvision.datasets.CIFAR10.html) dataset.

#### Training on Paintings

One of the good candidates for GAN training are paintings created by human artists.

![](https://soshnikov.com/images/artartificial/Flo1.jpg)

(Photo from [Art of Artificial](https://soshnikov.com/museum/art-artificial/) collection)

#### References

* [GAN arxiv](https://arxiv.org/abs/1406.2661)
* [DCGAN arxiv](https://arxiv.org/abs/1511.06434)
* [DCGAN Pytorch tutorial](https://pytorch.org/tutorials/beginner/dcgan_faces_tutorial.html)

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/10-GANs/GANTF.ipynb`）:

The main goal of **Generative Adversarial Network** (GAN) is to generate images that are similar (but not identical) to training dataset.

GAN consists of two neural networks that are trained against each other:

 * **Generator** takes a random vector, and should generate an image from it
 * **Discriminator** is a networks that should distinguish between original image (from training dataset), and the one generated by the generator.

<img src="./images/gan_architecture.png" width="70%"/>

```python
import tensorflow as tf
import tensorflow.keras as keras
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import *
import matplotlib.pyplot as plt
import numpy as np
```

#### Generator

The role of a generator is to take a random vector of some size (it is similar to latent vector in autoencoders) and generate the target image. It is very similar to the generative side of autoencoder.

In our example, we will use dense neural networks and MNIST dataset.

```python
generator = Sequential()
generator.add(Dense(256, input_shape=(100,)))
generator.add(LeakyReLU(alpha=0.2))
generator.add(BatchNormalization(momentum=0.8))
generator.add(Dense(512))
generator.add(LeakyReLU(alpha=0.2))
generator.add(BatchNormalization(momentum=0.8))
generator.add(Dense(1024))
generator.add(LeakyReLU(alpha=0.2))
generator.add(BatchNormalization(momentum=0.8))
generator.add(Dense(784, activation='tanh'))
generator.add(Reshape((28,28)))

optimizer = keras.optimizers.Adam(lr=0.0002, decay=8e-9)

generator.compile(loss='binary_crossentropy',optimizer=optimizer,metrics=['accuracy'])

```

A few tricks used in generator:
* Instead of ReLU, we use **Leaky ReLU**, i.e. a ReLU which is not exactly 0 for negative $x$, but rather another linear function with very small slope. This is important, because it helps gradient descent to propagate values even if we are on the negative side of ReLU (where values are 0)
* We use Batch Normalization in order to stabilize training
* The activation function on last layer is `tanh`, so the output is in the range [-1,1]

#### Discriminator

Discriminator is a classical image classification network. In our first example, we will also use dense classifier.

```python
discriminator = Sequential()
discriminator.add(Flatten(input_shape=(28,28)))
discriminator.add(Dense(784))

discriminator.add(LeakyReLU(alpha=0.2))
discriminator.add(Dense(784//2))
discriminator.add(LeakyReLU(alpha=0.2))

discriminator.add(Dense(1, activation='sigmoid'))

discriminator.compile(loss='binary_crossentropy',optimizer=optimizer,metrics=['accuracy'])
```

We will also define an adversarial network, which is generator followed by discriminator. This network starts with a noise vector, and returns a binary result.

```python
discriminator.trainable = False
adversarial = Sequential()
adversarial.add(generator)
adversarial.add(discriminator)
adversarial.compile(loss='binary_crossentropy', optimizer=optimizer)
```

#### Loading dataset

We will use MNIST dataset, built into Keras:

```python
(X_train, _), (_, _) = keras.datasets.mnist.load_data()
X_train = (X_train.astype(np.float32) - 127.5) / 127.5
```

#### Network training

On each step of the training, we have two phases:

* Training discriminator:
   - We generate some random vectors `noise`. Training happens in minibatches, so we use `batch//2` vectors to produce `batch//2` generated images
   - Sample `batch//2` random images from the dataset
   - Train discriminator on 50% real and 50% generated images, providing corresponding labels (0 or 1)
 * Train the generator by using combined adversarial model, passing random vectors as input, and expecting 1's as output (which corresponds to real images)

```python
def plotn(n):
  noise = np.random.normal(0, 1, (n,100))
  imgs = generator.predict(noise)
  fig,ax = plt.subplots(1,n)
  for i,im in enumerate(imgs):
    ax[i].imshow(im.reshape(28,28))
  plt.show()
```

```python
batch=32
for cnt in range(3000):
## train discriminator
  random_index =  np.random.randint(0, len(X_train) - batch//2)
  legit_images = X_train[random_index : random_index + batch//2].reshape(batch//2, 28, 28)
  gen_noise = np.random.normal(0, 1, (batch//2,100))
  syntetic_images = generator.predict(gen_noise)
  x_combined_batch = np.concatenate((legit_images, syntetic_images))
  y_combined_batch = np.concatenate((np.ones((batch//2, 1)), np.zeros((batch//2, 1))))
  d_loss = discriminator.train_on_batch(x_combined_batch, y_combined_batch)
# train generator
  noise = np.random.normal(0, 1, (batch,100))
  y_mislabled = np.ones((batch, 1))
  g_loss = adversarial.train_on_batch(noise, y_mislabled)
  if cnt%500==0:
    print ('epoch: %d, [Discriminator :: d_loss: %f], [ Generator :: loss: %f]' % (cnt, d_loss[0], g_loss))
    plotn(5)
```

> **Task**: You can train this GAN on the whole MNIST dataset and see how good can it get

#### DCGAN

In the previous example, we have used dense networks for both generator and discriminator, but we know that CNNs provide better performance when dealing with images. **Deep Convolutional GAN** is similar to the architecture above, but it uses convolutional layers for generator and discriminator. 

The main difficulty here is to build an architecture for denerator, because it has to do an inverse task compared to traditional CNN - it has to generate image from feature vector. In a way, this is similar to decoder part of autoencoders.That's why we will be using `Conv2DTranspose` layers in the generator.

```python
(X_train, _), (_, _) = keras.datasets.mnist.load_data()
X_train = (X_train.astype(np.float32)-127.5) / 127.5
print(X_train.min(),X_train.max())
```

```python
generator = Sequential()
generator.add(Dense(128 * 7 * 7, activation="relu", input_dim=100))
generator.add(Reshape((7, 7, 128)))
generator.add(UpSampling2D())
generator.add(Conv2DTranspose(128, kernel_size=3, padding="same"))
generator.add(BatchNormalization(momentum=0.8))
generator.add(Activation("relu"))
generator.add(UpSampling2D())
generator.add(Conv2DTranspose(64, kernel_size=3, padding="same"))
generator.add(BatchNormalization(momentum=0.8))
generator.add(Activation("relu"))
generator.add(Conv2DTranspose(1, kernel_size=3, padding="same"))
generator.add(Activation("tanh"))

optimizer = keras.optimizers.Adam(0.0001) #, 0.5)

generator.compile(loss='binary_crossentropy',optimizer=optimizer,metrics=['accuracy'])
generator.summary()
```

```python
discriminator = Sequential()

discriminator.add(Conv2D(32, kernel_size=3, strides=2, input_shape=(28,28,1), padding="same"))
discriminator.add(LeakyReLU(alpha=0.2))
discriminator.add(Dropout(0.25))
discriminator.add(Conv2D(64, kernel_size=3, strides=2, padding="same"))
discriminator.add(ZeroPadding2D(padding=((0,1),(0,1))))
discriminator.add(BatchNormalization(momentum=0.8))
discriminator.add(LeakyReLU(alpha=0.2))
discriminator.add(Dropout(0.25))
discriminator.add(Conv2D(128, kernel_size=3, strides=2, padding="same"))
discriminator.add(BatchNormalization(momentum=0.8))
discriminator.add(LeakyReLU(alpha=0.2))
discriminator.add(Dropout(0.25))
discriminator.add(Conv2D(256, kernel_size=3, strides=1, padding="same"))
discriminator.add(BatchNormalization(momentum=0.8))
discriminator.add(LeakyReLU(alpha=0.2))
discriminator.add(Dropout(0.25))
discriminator.add(Flatten())
discriminator.add(Dense(1, activation='sigmoid'))

discriminator.compile(loss='binary_crossentropy',optimizer=optimizer)
```

```python
discriminator.trainable = False
adversarial = Sequential()
adversarial.add(generator)
adversarial.add(discriminator)
adversarial.compile(loss='binary_crossentropy', optimizer=optimizer)
```

```python
batch=32
y_labeled = np.ones((batch, 1))
y_mislabeled = np.zeros((batch, 1))
for cnt in range(1000):
## train discriminator
  random_index =  np.random.randint(0, len(X_train) - batch)
  legit_images = X_train[random_index : random_index + batch].reshape(batch, 28, 28, 1)
  gen_noise = np.random.normal(0, 1, (batch,100))
  syntetic_images = generator.predict(gen_noise)
  d_loss_1 = discriminator.train_on_batch(legit_images, y_labeled)
  d_loss_2 = discriminator.train_on_batch(syntetic_images, y_mislabeled)
  d_loss = 0.5*np.add(d_loss_1,d_loss_2)
# train generator
  g_loss = adversarial.train_on_batch(gen_noise, y_labeled)
  if cnt%100==0:
    print ('epoch: %d, [Discriminator :: d_loss: %f], [ Generator :: loss: %f]' % (cnt, d_loss, g_loss))
    plotn(5)
```

> **Task**: Try generating more complex color images with DCGAN - for example, take one class from [CIFAR-10](https://keras.io/api/datasets/cifar10/) dataset.

#### Training on Paintings

One of the good candidates for GAN training are paintings created by human artists. Below is a sample image produced by DCGAN trained on a dataset from [WikiArt](http://wikiart.org). [KeraGAN](http://github.com/shwars/keragan) library was used to produce this image [using Azure Machine Learning](https://soshnikov.com/scienceart/creating-generative-art-using-gan-on-azureml/)

![](https://soshnikov.com/images/artartificial/Flo1.jpg)

(Photo from [Art of Artificial](https://soshnikov.com/museum/art-artificial/) collection)

#### References

* [Keras implementation of different toy GAN architectures](https://github.com/eriklindernoren/Keras-GAN)
* [KeraGAN Library](http://github.com/shwars/Keragan)
* [Blog post about creating GANs on Azure ML](https://soshnikov.com/scienceart/creating-generative-art-using-gan-on-azureml-ru/)

### Discriminator

The architecture of discriminator does not differ from an ordinary image classification network. In the simplest case it can be fully-connected classifier, but most probably it will be a [convolutional network](../07-ConvNets/README.md).

> ✅ A GAN based on convolutional networks is called a [DCGAN](https://arxiv.org/pdf/1511.06434.pdf)

A CNN discriminator consists of the following layers: several convolutions+poolings (with decreasing spatial size) and, one-or-more fully-connected layers to get "feature vector", final binary classifier.

> ✅ A 'pooling' in this context is a technique that reduces the size of the image. "Pooling layers reduce the dimensions of data by combining the outputs of neuron clusters at one layer into a single neuron in the next layer." - [source](https://wikipedia.org/wiki/Convolutional_neural_network#Pooling_layers)

### Generator

A Generator is slightly more tricky. You can consider it to be a reversed discriminator. Starting from a latent vector (in place of a feature vector), it has a fully-connected layer to convert it into the required size/shape, followed by deconvolutions+upscaling. This is similar to *decoder* part of [autoencoder](../09-Autoencoders/README.md).

> ✅ Because the convolution layer is implemented as a linear filter traversing the image, deconvolution is essentially similar to convolution, and can be implemented using the same layer logic.

<img src="images/gan_arch_detail.png" width="70%"/>

> Image by [Dmitry Soshnikov](http://soshnikov.com)

### Training the GAN

GANs are called **adversarial** because there is a constant competition between the generator and the discriminator. During this competition, both generator and discriminator improve, thus the network learns to produce better and better pictures.

The training happens in two stages:

* **Training the discriminator**. This task is pretty straightforward: we generate a batch of images by the generator, labeling them 0, which stands for fake image, and taking a batch of images from the input dataset (with label 1, real image). We obtain some *discriminator loss*, and perform backprop.
* **Training the generator**. This is slightly more tricky, because we do not know the expected output for the generator directly. We take the whole GAN network consisting of a generator followed by discriminator, feed it with some random vectors, and expect the result to be 1 (corresponding to real images). We then freeze the parameters of the discriminator (we do not want it to be trained at this step), and perform the backprop.

During this process, both the generator and the discriminator losses are not going down significantly. In the ideal situation, they should oscillate, corresponding to both networks improving their performance.

### Problems with GAN training

GANs are known to be especially difficult to train. Here are a few problems:

* **Mode Collapse**. By this term we mean that the generator learns to produce one successful image that tricks the generator, and not a variety of different images.
* **Sensitivity to hyperparameters**. Often you can see that a GAN does not converge at all, and then suddenly decreases in the learning rate leading to convergence.
* Keeping a **balance** between the generator and the discriminator. In many cases discriminator loss can drop to zero relatively quickly, which results in the generator being unable to train further. To overcome this, we can try setting different learning rates for the generator and discriminator, or skip discriminator training if the loss is already too low.
* Training for **high resolution**. Reflecting the same problem as with autoencoders, this problem is triggered because reconstructing too many layers of convolutional network leads to artifacts. This problem is typically solved with so-called **progressive growing**, when first a few layers are trained on low-res images, and then layers are "unblocked" or added. Another solution would be adding extra connections between layers and training several resolutions at once - see this [Multi-Scale Gradient GANs paper](https://arxiv.org/abs/1903.06048) for details.

---

**🔧 练习**（来自 `lessons/4-ComputerVision/11-ObjectDetection/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

Counting number of people on video surveillance camera stream is an important task that will allow us to estimate the number of visitors in a shops, busy hours in a restaurant, etc. To solve this task, we need to be able to detect human heads from different angles. To train object detection model to detect human heads, we can use [Hollywood Heads Dataset](https://www.di.ens.fr/willow/research/headdetection/).

#### The Dataset

[Hollywood Heads Dataset](https://www.di.ens.fr/willow/research/headdetection/release/HollywoodHeads.zip) contains 369,846 human heads annotated in 224,740 movie frames from Hollywood movies. It is provided in [https://host.robots.ox.ac.uk/pascal/VOC/](PASCAL VOC) format, where for each image there is also an XML description file that looks like this:

```xml
<annotation>
	<folder>HollywoodHeads</folder>
	<filename>mov_021_149390.jpeg</filename>
	<source>
		<database>HollywoodHeads 2015 Database</database>
		<annotation>HollywoodHeads 2015</annotation>
		<image>WILLOW</image>
	</source>
	<size>
		<width>608</width>
		<height>320</height>
		<depth>3</depth>
	</size>
	<segmented>0</segmented>
	<object>
		<name>head</name>
		<bndbox>
			<xmin>201</xmin>
			<ymin>1</ymin>
			<xmax>480</xmax>
			<ymax>263</ymax>
		</bndbox>
		<difficult>0</difficult>
	</object>
	<object>
		<name>head</name>
		<bndbox>
			<xmin>3</xmin>
			<ymin>4</ymin>
			<xmax>241</xmax>
			<ymax>285</ymax>
		</bndbox>
		<difficult>0</difficult>
	</object>
</annotation>
```

In this dataset, there is only one class of objects `head`, and for each head, you get the coordinates of the bounding box. You can parse XML using Python libraries, or use [this library](https://pypi.org/project/pascal-voc/) to deal directly with PASCAL VOC format.

#### Training Object Detection 

You can train an object detection model using one of the following ways:

* Using [Azure Custom Vision](https://docs.microsoft.com/azure/cognitive-services/custom-vision-service/quickstarts/object-detection?tabs=visual-studio&WT.mc_id=academic-77998-cacaste) and it's Python API to programmatically train the model in the cloud. Custom vision will not be able to use more than a few hundred images for training the model, so you may need to limit the dataset.
* Using the example from [Keras tutorial](https://keras.io/examples/vision/retinanet/) to train RetunaNet model.
* Using [torchvision.models.detection.RetinaNet](https://pytorch.org/vision/stable/_modules/torchvision/models/detection/retinanet.html) build-in module in torchvision.

#### Takeaway

Object detection is a task that is frequently required in industry. While there are some services that can be used to perform object detection (such as [Azure Custom Vision](https://docs.microsoft.com/azure/cognitive-services/custom-vision-service/quickstarts/object-detection?tabs=visual-studio&WT.mc_id=academic-77998-cacaste)), it is important to understand how object detection works and to be able to train your own models. 

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/11-ObjectDetection/ObjectDetection.ipynb`）:

#### Object Detection

This is a notebooks from [AI for Beginners Curriculum](http://aka.ms/ai-beginners)

![Image Algorithms](https://cdn-images-1.medium.com/max/840/1*Hz6t-tokG1niaUfmcysusw.jpeg)

#### Naive Approach to Object Detection

* Break image into tiles
* Run CNN image classified through each time
* Select tiles with activation above the threshold

```python
import cv2
from tensorflow import keras
import numpy as np
import matplotlib.pyplot as plt
import os
```

Let's read sample image to play with and pad it to square dimension:

```python
img = cv2.imread('images/1200px-Girl_and_cat.jpg')
img = cv2.cvtColor(img,cv2.COLOR_BGR2RGB)
img = np.pad(img,((158,158),(0,0),(0,0)),mode='edge')
plt.imshow(img)
```

We will use pre-trained VGG-16 CNN:

```python
vgg = keras.applications.vgg16.VGG16(weights='imagenet')
```

Let's define a function that will predict the probability of a cat on the image. Since ImageNet contains a number of classes for cats, indexed from 281 to 294, we will just add probabilities for those classes to get overall 'cat' probability:

```python
def predict(img):
  im = cv2.resize(img,(224,224))
  im = keras.applications.vgg16.preprocess_input(im)
  pr = vgg.predict(np.expand_dims(im,axis=0))[0]
  return np.sum(pr[281:294]) # we know that VGG classes for cats are from 281 to 294

predict(img)
```

Next function will build a heatmap of probabilities, dividing the image into $n\times n$ squares:

```python
def predict_map(img,n):
  dx = img.shape[0] // n
  res = np.zeros((n,n),dtype=np.float32)
  for i in range(n):
    for j in range(n):
      im = img[dx*i:dx*(i+1),dx*j:dx*(j+1)]
      r = predict(im)
      res[i,j] = r
  return res

fig,ax = plt.subplots(1,2,figsize=(15,5))
ax[1].imshow(img)
ax[0].imshow(predict_map(img,10))
```

#### Detecting Simple Objects

To give more precise location of a bounding box, we need to run **regression model** to predict bounding box coordinates. Let's start with simple example of having black rectangles in 32x32 images, which we want to detect. The idea and some code are borrowed from [this blog post](https://towardsdatascience.com/object-detection-with-neural-networks-a4e2c46b4491).

The following function will generate a bunch of sample images:

```python
def generate_images(num_imgs, img_size=8, min_object_size = 1, max_object_size = 4):
    bboxes = np.zeros((num_imgs, 4))
    imgs = np.zeros((num_imgs, img_size, img_size))  # set background to 0

    for i_img in range(num_imgs):
        w, h = np.random.randint(min_object_size, max_object_size, size=2)
        x = np.random.randint(0, img_size - w)
        y = np.random.randint(0, img_size - h)
        imgs[i_img, x:x+w, y:y+h] = 1.  # set rectangle to 1
        bboxes[i_img] = [x, y, w, h]
    return imgs, bboxes

imgs, bboxes = generate_images(100000)
print(f"Images shape = {imgs.shape}")
print(f"BBoxes shape = {bboxes.shape}")
```

To make outputs of the network in the range [0;1], we will divide `bboxes` by the image size:

```python
bb = bboxes/8.0
bb[0]
```

In our simple example, we will use dense neural network. In real life, when objects have more complex shape, it definitely makes sense to use CNNs for the task like this. We will use stochastic gradient descent optimizer and mean squared error (MSE) as the metrics, because our task is **regression**.

```python
model = keras.Sequential([
    keras.layers.Flatten(input_shape=(8,8)),
    keras.layers.Dense(200, activation='relu'),
    keras.layers.Dropout(0.2),
    keras.layers.Dense(4)
])
model.compile('sgd','mse')
model.summary()
```

Let's train our network. We will also normalize the input data (by subtracting mean and dividing by standard deviation) for slightly better performance.

```python
imgs_norm = (imgs-np.mean(imgs))/np.std(imgs)
model.fit(imgs_norm,bb,epochs=30)
```

We seem to have relatively good loss, let's see how it translates into more tangible metrics, such as mAP. First, let's define IOU metric between two bounding boxes:

```python
def IOU(bbox1, bbox2):
    '''Calculate overlap between two bounding boxes [x, y, w, h] as the area of intersection over the area of unity'''
    x1, y1, w1, h1 = bbox1[0], bbox1[1], bbox1[2], bbox1[3]
    x2, y2, w2, h2 = bbox2[0], bbox2[1], bbox2[2], bbox2[3]
    w_I = min(x1 + w1, x2 + w2) - max(x1, x2)
    h_I = min(y1 + h1, y2 + h2) - max(y1, y2)
    if w_I <= 0 or h_I <= 0:  # no overlap
        return 0.
    I = w_I * h_I
    U = w1 * h1 + w2 * h2 - I
    return I / U
```

We will now generate 500 test images, and plot first 5 of them to visualize how accurate we are. We will print out IOU metric as well.

```python
import matplotlib

test_imgs, test_bboxes = generate_images(500)
bb_res = model.predict((test_imgs-np.mean(imgs))/np.std(imgs))*8

plt.figure(figsize=(15,5))
for i in range(5):
    print(f"pred={bb_res[i]},act={test_bboxes[i]}, IOU={IOU(bb_res[i],test_bboxes[i])}")
    plt.subplot(1,5,i+1)
    plt.imshow(test_imgs[i])
    plt.gca().add_patch(matplotlib.patches.Rectangle((bb_res[i,1],bb_res[i,0]),bb_res[i,3],bb_res[i,2],ec='r'))
    #plt.annotate('IOU: {:.2f}'.format(IOU(bb_res[i],test_bboxes[i])),(bb_res[i,1],bb_res[i,0]+bb_res[i,3]),color='y')

```

Now to calculate mean precision over all cases, we just need to go over all our test samples, compute IoU, and calculate mean:

```python
np.array([IOU(a,b) for a,b in zip(test_bboxes,bb_res)]).mean()
```

#### Real-Life Object Detection

Real object detection algorithms are more complicated. We will recommend you to follow [Keras tutorial on Object Detection with RetinaNet](https://keras.io/examples/vision/retinanet/) if you want to get into the details of RetinaNet implementation, or use [Keras RetinaNet Library](https://github.com/fizyr/keras-retinanet), if you just want to train object detection model.

### Intersection over Union

While for image classification it is easy to measure how well the algorithm performs, for object detection we need to measure both the correctness of the class, as well as the precision of the inferred bounding box location. For the latter, we use the so-called **Intersection over Union** (IoU), which measures how well two boxes (or two arbitrary areas) overlap.

![IoU](images/iou_equation.png)

> *Figure 2 from [this excellent blog post on IoU](https://pyimagesearch.com/2016/11/07/intersection-over-union-iou-for-object-detection/)*

The idea is simple - we divide the area of intersection between two figures by the area of their union. For two identical areas, IoU would be 1, while for completely disjointed areas it will be 0. Otherwise it will vary from 0 to 1. We typically only consider those bounding boxes for which IoU is over a certain value.

### Average Precision

Suppose we want to measure how well a given class of objects $C$ is recognized. To measure it, we use **Average Precision** metrics, which is calculated as follows:

1. Consider Precision-Recall curve shows the accuracy depending on a detection threshold value (from 0 to 1).
2. Depending on the threshold, we will get more or less objects detected in the image, and different values of precision and recall.
3. The curve will look like this:

<img src="https://github.com/shwars/NeuroWorkshop/raw/master/images/ObjDetectionPrecisionRecall.png"/>

> *Image from [NeuroWorkshop](http://github.com/shwars/NeuroWorkshop)*

The average Precision for a given class $C$ is the area under this curve. More precisely, Recall axis is typically divided into 10 parts, and Precision is averaged over all those points:

$$
AP = {1\over11}\sum_{i=0}^{10}\mbox{Precision}(\mbox{Recall}={i\over10})
$$

### AP and IoU

We shall consider only those detections, for which IoU is above a certain value. For example, in PASCAL VOC dataset typically $\mbox{IoU Threshold} = 0.5$ is assumed, while in COCO AP is measured for different values of $\mbox{IoU Threshold}$.

<img src="https://github.com/shwars/NeuroWorkshop/raw/master/images/ObjDetectionPrecisionRecallIoU.png"/>

> *Image from [NeuroWorkshop](http://github.com/shwars/NeuroWorkshop)*

### Mean Average Precision - mAP

The main metric for Object Detection is called **Mean Average Precision**, or **mAP**. It is the value of Average Precision, average across all object classes, and sometimes also over $\mbox{IoU Threshold}$. In more detail, the process of calculating **mAP** is described
[in this blog post](https://medium.com/@timothycarlen/understanding-the-map-evaluation-metric-for-object-detection-a07fe6962cf3)), and also [here with code samples](https://gist.github.com/tarlen5/008809c3decf19313de216b9208f3734).

### R-CNN: Region-Based CNN

[R-CNN](http://islab.ulsan.ac.kr/files/announcement/513/rcnn_pami.pdf) uses [Selective Search](http://www.huppelen.nl/publications/selectiveSearchDraft.pdf) to generate hierarchical structure of ROI regions, which are then passed through CNN feature extractors and SVM-classifiers to determine the object class, and linear regression to determine *bounding box* coordinates. [Official Paper](https://arxiv.org/pdf/1506.01497v1.pdf)

![RCNN](images/rcnn1.png)

> *Image from van de Sande et al. ICCV’11*

![RCNN-1](images/rcnn2.png)

> *Images from [this blog](https://towardsdatascience.com/r-cnn-fast-r-cnn-faster-r-cnn-yolo-object-detection-algorithms-36d53571365e)

### F-RCNN - Fast R-CNN

This approach is similar to R-CNN, but regions are defined after convolution layers have been applied.

![FRCNN](images/f-rcnn.png)

> Image from [the Official Paper](https://www.cv-foundation.org/openaccess/content_iccv_2015/papers/Girshick_Fast_R-CNN_ICCV_2015_paper.pdf), [arXiv](https://arxiv.org/pdf/1504.08083.pdf), 2015

### Faster R-CNN

The main idea of this approach is to use neural network to predict ROIs - so-called *Region Proposal Network*. [Paper](https://arxiv.org/pdf/1506.01497.pdf), 2016

![FasterRCNN](images/faster-rcnn.png)

> Image from [the official paper](https://arxiv.org/pdf/1506.01497.pdf)

### R-FCN: Region-Based Fully Convolutional Network

This algorithm is even faster than Faster R-CNN. The main idea is the following:

1. We extract features using ResNet-101
1. Features are processed by **Position-Sensitive Score Map**. Each object from $C$ classes is divided by $k\times k$ regions, and we are training to predict parts of objects.
1. For each part from $k\times k$ regions all networks vote for object classes, and the object class with maximum vote is selected.

![r-fcn image](images/r-fcn.png)

> Image from [official paper](https://arxiv.org/abs/1605.06409)

### YOLO - You Only Look Once

YOLO is a realtime one-pass algorithm. The main idea is the following:

 * Image is divided into $S\times S$ regions
 * For each region, **CNN** predicts $n$ possible objects, *bounding box* coordinates and *confidence*=*probability* * IoU.

 ![YOLO](images/yolo.png)

> Image from [official paper](https://arxiv.org/abs/1506.02640)

### Other Algorithms

* RetinaNet: [official paper](https://arxiv.org/abs/1708.02002)
   - [PyTorch Implementation in Torchvision](https://pytorch.org/vision/stable/_modules/torchvision/models/detection/retinanet.html)
   - [Keras Implementation](https://github.com/fizyr/keras-retinanet)
   - [Object Detection with RetinaNet](https://keras.io/examples/vision/retinanet/) in Keras Samples
* SSD (Single Shot Detector): [official paper](https://arxiv.org/abs/1512.02325)

### Segmentation

We have previously learned about Object Detection, which allows us to locate objects in the image by predicting their *bounding boxes*. However, for some tasks we do not only need bounding boxes, but also more precise object localization. This task is called  **segmentation**.

Segmentation can be viewed as **pixel classification**, whereas for **each** pixel of image we must predict its class (*background* being one of the classes). There are two main segmentation algorithms:

* **Semantic segmentation** only tells the pixel class, and does not make a distinction between different objects of the same class
* **Instance segmentation** divides classes into different instances.

For instance segmentation, these sheep are different objects, but for semantic segmentation all sheep are represented by one class.

<img src="images/instance_vs_semantic.jpeg" width="50%">

> Image from [this blog post](https://nirmalamurali.medium.com/image-classification-vs-semantic-segmentation-vs-instance-segmentation-625c33a08d50)

There are different neural architectures for segmentation, but they all have the same structure. In a way, it is similar to the autoencoder you learned about previously, but instead of deconstructing the original image, our goal is to deconstruct a **mask**. Thus, a segmentation network has the following parts:

* **Encoder** extracts features from input image
* **Decoder** transforms those features into the **mask image**, with the same size and number of channels corresponding to the number of classes.

<img src="images/segm.png" width="80%">

> Image from [this publication](https://arxiv.org/pdf/2001.05566.pdf)

We should especially mention the loss function that is used for segmentation. When using classical autoencoders, we need to measure the similarity between two images, and we can use mean square error (MSE) to do that. In segmentation, each pixel in the target mask image represents the class number (one-hot-encoded along the third dimension), so we need to use loss functions specific for classification - cross-entropy loss, averaged over all pixels. If the mask is binary - **binary cross-entropy loss** (BCE) is used.

> ✅ One-hot encoding is a way to encode a class label into a vector of length equal to the number of classes. Take a look at [this article](https://datagy.io/sklearn-one-hot-encode/) on this technique.

#### Segmentation for Medical Imaging

In this lesson, we will see the segmentation in action by training the network to recognize human nevi (also known as moles) on medical images. We will be using <a href="https://www.fc.up.pt/addi/ph2%20database.html">PH<sup>2</sup> Database</a> of dermoscopy images as the image source. This dataset contains 200 images of three classes: typical nevus, atypical nevus, and melanoma. All images also contain a corresponding **mask** that outlines the nevus.

> ✅ This technique is particularly appropriate for this type of medical imaging, but what other real-world applications could you envision?

<img alt="navi" src="images/navi.png"/>

> Image from the PH<sup>2</sup> Database

We will train a model to segment any nevus from its background.

#### ✍️ Exercises: Semantic Segmentation

Open the notebooks below to learn more about different semantic segmentation architectures, practice working with them, and see them in action.

* [Semantic Segmentation Pytorch](SemanticSegmentationPytorch.ipynb)
* [Semantic Segmentation TensorFlow](SemanticSegmentationTF.ipynb)

#### Conclusion

Segmentation is a very powerful technique for image classification, moving beyond bounding boxes to pixel-level classification. It is a technique used in medical imaging, among other applications.

#### 🚀 Challenge

Body segmentation is just one of the common tasks that we can do with images of people. Another important tasks include **skeleton detection** and **pose detection**. Try out [OpenPose](https://github.com/CMU-Perceptual-Computing-Lab/openpose) library to see how pose detection can be used.

#### Review & Self Study

This [wikipedia article](https://wikipedia.org/wiki/Image_segmentation) offers a good overview of the various applications of this technique. Learn more on your own about the subdomains of Instance segmentation and Panoptic segmentation in this field of inquiry.

#### Prerequsites

To begin with, we will import required libraries, and check if there is GPU available for training.

```python
import torch
import torchvision
import matplotlib.pyplot as plt
from torchvision import transforms
from torch import nn
from torch import optim
from tqdm import tqdm
import numpy as np
import torch.nn.functional as F
from skimage.io import imread
from skimage.transform import resize
import os
torch.manual_seed(42)
np.random.seed(42)
```

```python
device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
train_size = 0.9
lr = 1e-3
weight_decay = 1e-6
batch_size = 32
epochs = 30
```

#### The Dataset

We will use the <a href="https://www.fc.up.pt/addi/ph2%20database.html">PH<sup>2</sup> Database</a> of dermoscopy images of human nevi. This dataset contains 200 images of three classes: typical nevus, atypical nevus, and melanoma. All images also contain corresponding **mask** that outline the nevus.

The code below downloads the dataset from the original location and decompresses it. You would need to have `unrar` utility installed in order for this code to work, you may install it using `sudo apt-get install unrar` on Linux, or by downloading command-line version for Windows [here](https://www.rarlab.com/rar_add.htm).

```python
#!apt-get install rar
!wget https://www.dropbox.com/s/k88qukc20ljnbuo/PH2Dataset.rar
!unrar x -Y PH2Dataset.rar
```

Now we will define the code to load the dataset. We will transform all images into 256x256 size, and split the dataset into train and test part. This function returns train and test datasets, each containing original images and masks outlining the nevus.

```python
def load_dataset(train_part, root='PH2Dataset'):
    images = []
    masks = []

    for root, dirs, files in os.walk(os.path.join(root, 'PH2 Dataset images')):
        if root.endswith('_Dermoscopic_Image'):
            images.append(imread(os.path.join(root, files[0])))
        if root.endswith('_lesion'):
            masks.append(imread(os.path.join(root, files[0])))

    size = (256, 256)
    images = torch.permute(torch.FloatTensor(np.array([resize(image, size, mode='constant', anti_aliasing=True,) for image in images])), (0, 3, 1, 2))
    masks = torch.FloatTensor(np.array([resize(mask, size, mode='constant', anti_aliasing=False) > 0.5 for mask in masks])).unsqueeze(1)

    indices = np.random.permutation(range(len(images)))
    train_part = int(train_part * len(images))
    train_ind = indices[:train_part]
    test_ind = indices[train_part:]

    train_dataset = (images[train_ind, :, :, :], masks[train_ind, :, :, :])
    test_dataset = (images[test_ind, :, :, :], masks[test_ind, :, :, :])

    return train_dataset, test_dataset

train_dataset, test_dataset = load_dataset(train_size)
```

Let's now plot some of the images from the dataset to see how they look like:

```python
def plotn(n, data, only_mask=False):
    images, masks = data[0], data[1]
    fig, ax = plt.subplots(1, n)
    fig1, ax1 = plt.subplots(1, n)
    for i, (img, mask) in enumerate(zip(images, masks)):
        if i == n:
            break
        if not only_mask:
            ax[i].imshow(torch.permute(img, (1, 2, 0)))
        else:
            ax[i].imshow(img[0])
        ax1[i].imshow(mask[0])
        ax[i].axis('off')
        ax1[i].axis('off')
    plt.show()

plotn(5, train_dataset)
```

We will also need dataloaders to feed the data into our neural network.

```python
train_dataloader = torch.utils.data.DataLoader(list(zip(train_dataset[0], train_dataset[1])), batch_size=batch_size, shuffle=True)
test_dataloader = torch.utils.data.DataLoader(list(zip(test_dataset[0], test_dataset[1])), batch_size=1, shuffle=False)
dataloaders = (train_dataloader, test_dataloader)
```

#### SegNet

The simplest encoder-decoder architecture is called **SegNet**. It uses standard CNN with convolutions and poolings in the encoder, and deconvolution CNN that includes convolutions and upsamplings in decoder. It also relies on batch normalization to train multi-layered network successfully.

<img src="images/segnet.png" width="80%">

> Image from this paper: Badrinarayanan, V., Kendall, A., & Cipolla, R. (2015). [SegNet: A deep convolutional
encoder-decoder architecture for image segmentation](https://arxiv.org/pdf/1511.00561.pdf)

```python
class SegNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.enc_conv0 = nn.Conv2d(in_channels=3, out_channels=16, kernel_size=(3,3), padding=1)
        self.act0 = nn.ReLU()
        self.bn0 = nn.BatchNorm2d(16)
        self.pool0 = nn.MaxPool2d(kernel_size=(2,2))

        self.enc_conv1 = nn.Conv2d(in_channels=16, out_channels=32, kernel_size=(3,3), padding=1)
        self.act1 = nn.ReLU()
        self.bn1 = nn.BatchNorm2d(32)
        self.pool1 = nn.MaxPool2d(kernel_size=(2,2))

        self.enc_conv2 = nn.Conv2d(in_channels=32, out_channels=64, kernel_size=(3,3), padding=1)
        self.act2 = nn.ReLU()
        self.bn2 = nn.BatchNorm2d(64)
        self.pool2 =  nn.MaxPool2d(kernel_size=(2,2))

        self.enc_conv3 = nn.Conv2d(in_channels=64, out_channels=128, kernel_size=(3,3), padding=1)
        self.act3 = nn.ReLU()
        self.bn3 = nn.BatchNorm2d(128)
        self.pool3 =  nn.MaxPool2d(kernel_size=(2,2))

        self.bottleneck_conv = nn.Conv2d(in_channels=128, out_channels=256, kernel_size=(3,3), padding=1)
        
        self.upsample0 =  nn.UpsamplingBilinear2d(scale_factor=2)
        self.dec_conv0 = nn.Conv2d(in_channels=256, out_channels=128, kernel_size=(3,3), padding=1)
        self.dec_act0 = nn.ReLU()
        self.dec_bn0 = nn.BatchNorm2d(128)

        self.upsample1 =  nn.UpsamplingBilinear2d(scale_factor=2)
        self.dec_conv1 =  nn.Conv2d(in_channels=128, out_channels=64, kernel_size=(3,3), padding=1)
        self.dec_act1 = nn.ReLU()
        self.dec_bn1 = nn.BatchNorm2d(64)

        self.upsample2 = nn.UpsamplingBilinear2d(scale_factor=2)
        
        self.dec_conv2 = nn.Conv2d(in_channels=64, out_channels=32, kernel_size=(3,3), padding=1)
        self.dec_act2 = nn.ReLU()
        self.dec_bn2 = nn.BatchNorm2d(32)

        self.upsample3 = nn.UpsamplingBilinear2d(scale_factor=2)
        self.dec_conv3 = nn.Conv2d(in_channels=32, out_channels=1, kernel_size=(1,1))

        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        e0 = self.pool0(self.bn0(self.act0(self.enc_conv0(x))))
        e1 = self.pool1(self.bn1(self.act1(self.enc_conv1(e0))))
        e2 = self.pool2(self.bn2(self.act2(self.enc_conv2(e1))))
        e3 = self.pool3(self.bn3(self.act3(self.enc_conv3(e2))))

        b = self.bottleneck_conv(e3)

        d0 = self.dec_bn0(self.dec_act0(self.dec_conv0(self.upsample0(b))))
        d1 = self.dec_bn1(self.dec_act1(self.dec_conv1(self.upsample1(d0))))
        d2 = self.dec_bn2(self.dec_act2(self.dec_conv2(self.upsample2(d1))))
        d3 = self.sigmoid(self.dec_conv3(self.upsample3(d2)))
        return d3
```

We should especially mention the loss function that is used for segmentation. In classical autoencoders we need to measure the similarity between two images, and we can use mean square error to do that. In segmentation, each pixel in the target mask image represents the class number (one-hot-encoded along the third dimension), so we need to use loss functions specific for classification - cross-entropy loss, averaged over all pixels. If the mask is binary (as in our example) - we will use **binary cross-entropy loss** (BCE).   

```python
model = SegNet().to(device)
optimizer = optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
loss_fn = nn.BCEWithLogitsLoss()
```

Training loop is defined in the usual way:

```python
def train(dataloaders, model, loss_fn, optimizer, epochs, device):
    tqdm_iter = tqdm(range(epochs))
    train_dataloader, test_dataloader = dataloaders[0], dataloaders[1]

    for epoch in tqdm_iter:
        model.train()
        train_loss = 0.0
        test_loss = 0.0

        for batch in train_dataloader:
            imgs, labels = batch
            imgs = imgs.to(device)
            labels = labels.to(device)

            preds = model(imgs)
            loss = loss_fn(preds, labels)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        model.eval()
        with torch.no_grad():
            for batch in test_dataloader:
                imgs, labels = batch
                imgs = imgs.to(device)
                labels = labels.to(device)

                preds = model(imgs)
                loss = loss_fn(preds, labels)

                test_loss += loss.item()

        train_loss /= len(train_dataloader)
        test_loss /= len(test_dataloader)

        tqdm_dct = {'train loss:': train_loss, 'test loss:': test_loss}
        tqdm_iter.set_postfix(tqdm_dct, refresh=True)
        tqdm_iter.refresh()
```

```python
train(dataloaders, model, loss_fn, optimizer, epochs, device)
```

To evaluate our model, we will just plot target masks and predicted masks for a number of images:

```python
model.eval()
predictions = []
image_mask = []
plots = 5
images, masks = test_dataset[0], test_dataset[1]
for i, (img, mask) in enumerate(zip(images, masks)):
    if i == plots:
        break
    img = img.to(device).unsqueeze(0)
    predictions.append((model(img).detach().cpu()[0] > 0.5).float())
    image_mask.append(mask)
plotn(plots, (predictions, image_mask), only_mask=True)
```

There are also some formal metrics to evaluate the performance, which you can read about [here](https://towardsdatascience.com/metrics-to-evaluate-your-semantic-segmentation-model-6bcb99639aa2). The easiest one to understand is **pixel accuracy** - a percentage of pixels classified correctly.

#### U-Net

SegNet architecture is very natural, but it is not the most accurate. Indeed, we first apply pyramid CNN architecture to the original image, which reduces the spatial accuracy of image features. Then, when we reconstruct the image, we cannot correctly reconstruct the pixel positions.

This leads us to the idea of **skip connections** between convolution layers in encoder and decoder. This architecture is very common for semantic segmentation, and is called **U-Net**. Skip connections at each convolution level helps network not to lose information about features from original input at this level.

We will use quite simple CNN architecture here, but U-Net can also use more complex encoder for feature extraction, such as ResNet-50.

<img src="images/unet.png" width="70%">

> Image from paper: Ronneberger, Olaf, Philipp Fischer, and Thomas Brox. [U-Net: Convolutional networks for biomedical image segmentation.](https://arxiv.org/pdf/1505.04597.pdf)

```python
class UNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.enc_conv0 = nn.Conv2d(in_channels=3, out_channels=16, kernel_size=(3,3), padding=1)
        self.act0 = nn.ReLU()
        self.bn0 = nn.BatchNorm2d(16)
        self.pool0 = nn.MaxPool2d(kernel_size=(2,2))

        self.enc_conv1 = nn.Conv2d(in_channels=16, out_channels=32, kernel_size=(3,3), padding=1)
        self.act1 = nn.ReLU()
        self.bn1 = nn.BatchNorm2d(32)
        self.pool1 = nn.MaxPool2d(kernel_size=(2,2))

        self.enc_conv2 = nn.Conv2d(in_channels=32, out_channels=64, kernel_size=(3,3), padding=1)
        self.act2 = nn.ReLU()
        self.bn2 = nn.BatchNorm2d(64)
        self.pool2 =  nn.MaxPool2d(kernel_size=(2,2))

        self.enc_conv3 = nn.Conv2d(in_channels=64, out_channels=128, kernel_size=(3,3), padding=1)
        self.act3 = nn.ReLU()
        self.bn3 = nn.BatchNorm2d(128)
        self.pool3 =  nn.MaxPool2d(kernel_size=(2,2))

        self.bottleneck_conv = nn.Conv2d(in_channels=128, out_channels=256, kernel_size=(3,3), padding=1)
        
        self.upsample0 =  nn.UpsamplingBilinear2d(scale_factor=2)
        self.dec_conv0 = nn.Conv2d(in_channels=384, out_channels=128, kernel_size=(3,3), padding=1)
        self.dec_act0 = nn.ReLU()
        self.dec_bn0 = nn.BatchNorm2d(128)

        self.upsample1 =  nn.UpsamplingBilinear2d(scale_factor=2)
        self.dec_conv1 =  nn.Conv2d(in_channels=192, out_channels=64, kernel_size=(3,3), padding=1)
        self.dec_act1 = nn.ReLU()
        self.dec_bn1 = nn.BatchNorm2d(64)

        self.upsample2 = nn.UpsamplingBilinear2d(scale_factor=2)
        self.dec_conv2 = nn.Conv2d(in_channels=96, out_channels=32, kernel_size=(3,3), padding=1)
        self.dec_act2 = nn.ReLU()
        self.dec_bn2 = nn.BatchNorm2d(32)

        self.upsample3 = nn.UpsamplingBilinear2d(scale_factor=2)
        self.dec_conv3 = nn.Conv2d(in_channels=48, out_channels=1, kernel_size=(1,1))

        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        e0 = self.pool0(self.bn0(self.act0(self.enc_conv0(x))))
        e1 = self.pool1(self.bn1(self.act1(self.enc_conv1(e0))))
        e2 = self.pool2(self.bn2(self.act2(self.enc_conv2(e1))))
        e3 = self.pool3(self.bn3(self.act3(self.enc_conv3(e2))))

        cat0 = self.bn0(self.act0(self.enc_conv0(x)))
        cat1 = self.bn1(self.act1(self.enc_conv1(e0)))
        cat2 = self.bn2(self.act2(self.enc_conv2(e1)))
        cat3 = self.bn3(self.act3(self.enc_conv3(e2)))

        b = self.bottleneck_conv(e3)

        d0 = self.dec_bn0(self.dec_act0(self.dec_conv0(torch.cat((self.upsample0(b), cat3), dim=1))))
        d1 = self.dec_bn1(self.dec_act1(self.dec_conv1(torch.cat((self.upsample1(d0), cat2), dim=1))))
        d2 = self.dec_bn2(self.dec_act2(self.dec_conv2(torch.cat((self.upsample2(d1), cat1), dim=1))))
        d3 = self.sigmoid(self.dec_conv3(torch.cat((self.upsample3(d2), cat0), dim=1)))
        return d3
```

```python
model = UNet().to(device)
optimizer = optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
loss_fn = nn.BCEWithLogitsLoss()
```

```python
train(dataloaders, model, loss_fn, optimizer, epochs, device)
```

```python
model.eval()
predictions = []
image_mask = []
plots = 5
images, masks = test_dataset[0], test_dataset[1]
for i, (img, mask) in enumerate(zip(images, masks)):
    if i == plots:
        break
    img = img.to(device).unsqueeze(0)
    predictions.append((model(img).detach().cpu()[0] > 0.5).float())
    image_mask.append(mask)
plotn(plots, (predictions, image_mask), only_mask=True)
```

---

**📓 Notebook 代码**（来自 `lessons/4-ComputerVision/12-Segmentation/SemanticSegmentationTF.ipynb`）:

**Segmentation** is one of the main computer vision task. For **each** pixel of image you must specify class(background included). Semantic segmentation only tells pixel class, instance segmentation divide classes into different instances. 

For instance segmentation ten cars is **different** objects, for semantic segmentation **all** cars is one class.

<img src="images/instance_vs_semantic.jpeg" width="50%">

> Image from [this blog post](https://nirmalamurali.medium.com/image-classification-vs-semantic-segmentation-vs-instance-segmentation-625c33a08d50)

Almost all architectures have same structure. First part is **encoder** that extracts features from input image, second part is **decoder** that transforms this features into image with same height and width and some number of channels, may be equal to classes count.

<img src="images/segm.png" width="80%">

> Image from [this publication](https://arxiv.org/pdf/2001.05566.pdf)

```python
import tensorflow as tf
import tensorflow.keras.layers as keras
import matplotlib.pyplot as plt
from tqdm import tqdm
import numpy as np
from skimage.io import imread
from skimage.transform import resize
import os
import tensorflow.keras.optimizers as optimizers
import tensorflow.keras.losses as losses
from tensorflow.keras.preprocessing.image import ImageDataGenerator
tf.random.set_seed(42)
np.random.seed(42)
```

```python
train_size = 0.8
lr = 3e-4
weight_decay = 8e-9
batch_size = 64
epochs = 100
```

#### Dataset

```python
!apt-get install rar
!wget https://www.dropbox.com/s/k88qukc20ljnbuo/PH2Dataset.rar
!unrar x -Y PH2Dataset.rar
```

```python
def load_dataset(train_part, root='PH2Dataset'):
    images = []
    masks = []

    for root, dirs, files in os.walk(os.path.join(root, 'PH2 Dataset images')):
        if root.endswith('_Dermoscopic_Image'):
            images.append(imread(os.path.join(root, files[0])))
        if root.endswith('_lesion'):
            masks.append(imread(os.path.join(root, files[0])))

    size = (256, 256)
    images = np.array([resize(image, size, mode='constant', anti_aliasing=True,) for image in images])
    masks = np.expand_dims(np.array([resize(mask, size, mode='constant', anti_aliasing=False) > 0.5 for mask in masks]), axis=3)

    indices = np.random.permutation(range(len(images)))
    train_part = int(train_part * len(images))
    train_ind = indices[:train_part]
    test_ind = indices[train_part:]

    X_train = tf.cast(images[train_ind, :, :, :], tf.float32)
    y_train = tf.cast(masks[train_ind, :, :, :], tf.float32)

    X_test = tf.cast(images[test_ind, :, :, :], tf.float32)
    y_test = tf.cast(masks[test_ind, :, :, :], tf.float32)

    return (X_train, y_train), (X_test, y_test)
```

```python
(X_train, y_train), (X_test, y_test) = load_dataset(train_size)
```

```python
def plotn(n, data):
    images, masks = data[0], data[1]
    fig, ax = plt.subplots(1, n)
    fig1, ax1 = plt.subplots(1, n)
    for i, (img, mask) in enumerate(zip(images, masks)):
        if i == n:
            break
        ax[i].imshow(img)
        ax1[i].imshow(mask[:, :, 0])
    plt.show()
```

**Let's plot some images with corresponding masks.**

```python
plotn(5, (X_train, y_train))
```

#### SegNet

Simple encoder - decoder architecture with convolutions, poolings in encoder and convolutions, upsamplings in decoder.

<img src="images/segnet.png" width="80%">

* Badrinarayanan, V., Kendall, A., & Cipolla, R. (2015). [SegNet: A deep convolutional
encoder-decoder architecture for image segmentation](https://arxiv.org/pdf/1511.00561.pdf)

```python
class SegNet(tf.keras.Model):
    def __init__(self):
        super().__init__()
        self.enc_conv0 = keras.Conv2D(16, kernel_size=3, padding='same')
        self.bn0 = keras.BatchNormalization()
        self.relu0 = keras.Activation('relu')
        self.pool0 = keras.MaxPool2D()

        self.enc_conv1 = keras.Conv2D(32, kernel_size=3, padding='same')
        self.relu1 = keras.Activation('relu')
        self.bn1 = keras.BatchNormalization()
        self.pool1 = keras.MaxPool2D()

        self.enc_conv2 = keras.Conv2D(64, kernel_size=3, padding='same')
        self.relu2 = keras.Activation('relu')
        self.bn2 = keras.BatchNormalization()
        self.pool2 = keras.MaxPool2D()

        self.enc_conv3 = keras.Conv2D(128, kernel_size=3, padding='same')
        self.relu3 = keras.Activation('relu')
        self.bn3 = keras.BatchNormalization()
        self.pool3 = keras.MaxPool2D()

        self.bottleneck_conv = keras.Conv2D(256, kernel_size=(3, 3), padding='same')

        self.upsample0 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv0 = keras.Conv2D(128, kernel_size=3, padding='same')
        self.dec_relu0 = keras.Activation('relu')
        self.dec_bn0 = keras.BatchNormalization()

        self.upsample1 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv1 = keras.Conv2D(64, kernel_size=3, padding='same')
        self.dec_relu1 = keras.Activation('relu')
        self.dec_bn1 = keras.BatchNormalization()

        self.upsample2 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv2 = keras.Conv2D(32, kernel_size=3, padding='same')
        self.dec_relu2 = keras.Activation('relu')
        self.dec_bn2 = keras.BatchNormalization()

        self.upsample3 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv3 = keras.Conv2D(1, kernel_size=1)

    def call(self, input):
        e0 = self.pool0(self.relu0(self.bn0(self.enc_conv0(input))))
        e1 = self.pool1(self.relu1(self.bn1(self.enc_conv1(e0))))
        e2 = self.pool2(self.relu2(self.bn2(self.enc_conv2(e1))))
        e3 = self.pool3(self.relu3(self.bn3(self.enc_conv3(e2))))

        b = self.bottleneck_conv(e3)

        d0 = self.dec_relu0(self.dec_bn0(self.upsample0(self.dec_conv0(b))))
        d1 = self.dec_relu1(self.dec_bn1(self.upsample1(self.dec_conv1(d0))))
        d2 = self.dec_relu2(self.dec_bn2(self.upsample2(self.dec_conv2(d1))))
        d3 = self.dec_conv3(self.upsample3(d2))

        return d3
```

```python
model = SegNet()
optimizer = optimizers.Adam(learning_rate=lr, decay=weight_decay)
loss_fn = losses.BinaryCrossentropy(from_logits=True)

model.compile(loss=loss_fn, optimizer=optimizer)
```

```python
def train(datasets, model, epochs, batch_size):
    train_dataset, test_dataset = datasets[0], datasets[1]

    model.fit(train_dataset[0], train_dataset[1],
                epochs=epochs,
                batch_size=batch_size,
                shuffle=True,
                validation_data=(test_dataset[0], test_dataset[1]))
```

```python
train(((X_train, y_train), (X_test, y_test)), model, epochs, batch_size)
```

```python
predictions = []
image_mask = []
plots = 5

for i, (img, mask) in enumerate(zip(X_test, y_test)):
    if i == plots:
        break
    img = tf.expand_dims(img, 0)
    pred = np.array(model.predict(img))
    predictions.append(pred[0, :, :, 0] > 0.5)
    image_mask.append(mask)
plotn(plots, (predictions, image_mask))
```

#### U-Net

Very simple architecture that uses skip connections. Skip connections at each convolution level helps network doesn't lost information about features from original input at this level.

U-Net usually has a default encoder for feature extraction, for example resnet50.

<img src="images/unet.png" width="70%">

* Ronneberger, Olaf, Philipp Fischer, and Thomas Brox. [U-Net: Convolutional networks for biomedical image segmentation.](https://arxiv.org/pdf/1505.04597.pdf)

```python
class UNet(tf.keras.Model):
    def __init__(self):
        super().__init__()
        self.enc_conv0 = keras.Conv2D(16, kernel_size=3, padding='same')
        self.bn0 = keras.BatchNormalization()
        self.relu0 = keras.Activation('relu')
        self.pool0 = keras.MaxPool2D()

        self.enc_conv1 = keras.Conv2D(32, kernel_size=3, padding='same')
        self.relu1 = keras.Activation('relu')
        self.bn1 = keras.BatchNormalization()
        self.pool1 = keras.MaxPool2D()

        self.enc_conv2 = keras.Conv2D(64, kernel_size=3, padding='same')
        self.relu2 = keras.Activation('relu')
        self.bn2 = keras.BatchNormalization()
        self.pool2 = keras.MaxPool2D()

        self.enc_conv3 = keras.Conv2D(128, kernel_size=3, padding='same')
        self.relu3 = keras.Activation('relu')
        self.bn3 = keras.BatchNormalization()
        self.pool3 = keras.MaxPool2D()

        self.bottleneck_conv = keras.Conv2D(256, kernel_size=(3, 3), padding='same')

        self.upsample0 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv0 = keras.Conv2D(128, kernel_size=3, padding='same', input_shape=[None, 384, None, None])
        self.dec_relu0 = keras.Activation('relu')
        self.dec_bn0 = keras.BatchNormalization()

        self.upsample1 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv1 = keras.Conv2D(64, kernel_size=3, padding='same', input_shape=[None, 192, None, None])
        self.dec_relu1 = keras.Activation('relu')
        self.dec_bn1 = keras.BatchNormalization()

        self.upsample2 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv2 = keras.Conv2D(32, kernel_size=3, padding='same', input_shape=[None, 96, None, None])
        self.dec_relu2 = keras.Activation('relu')
        self.dec_bn2 = keras.BatchNormalization()

        self.upsample3 =  keras.UpSampling2D(interpolation='bilinear')
        self.dec_conv3 = keras.Conv2D(1, kernel_size=1, input_shape=[None, 48, None, None])

        self.cat0 = keras.Concatenate(axis=3)
        self.cat1 = keras.Concatenate(axis=3)
        self.cat2 = keras.Concatenate(axis=3)
        self.cat3 = keras.Concatenate(axis=3)

    def call(self, input):
        e0 = self.pool0(self.relu0(self.bn0(self.enc_conv0(input))))
        e1 = self.pool1(self.relu1(self.bn1(self.enc_conv1(e0))))
        e2 = self.pool2(self.relu2(self.bn2(self.enc_conv2(e1))))
        e3 = self.pool3(self.relu3(self.bn3(self.enc_conv3(e2))))

        cat0 = self.relu0(self.bn0(self.enc_conv0(input)))
        cat1 = self.relu1(self.bn1(self.enc_conv1(e0)))
        cat2 = self.relu2(self.bn2(self.enc_conv2(e1)))
        cat3 = self.relu3(self.bn3(self.enc_conv3(e2)))

        b = self.bottleneck_conv(e3)

        cat_tens0 = self.cat0([self.upsample0(b), cat3])
        d0 = self.dec_relu0(self.dec_bn0(self.dec_conv0(cat_tens0)))

        cat_tens1 = self.cat1([self.upsample1(d0), cat2])
        d1 = self.dec_relu1(self.dec_bn1(self.dec_conv1(cat_tens1)))

        cat_tens2 = self.cat2([self.upsample2(d1), cat1])
        d2 = self.dec_relu2(self.dec_bn2(self.dec_conv2(cat_tens2)))

        cat_tens3 = self.cat3([self.upsample3(d2), cat0])
        d3 = self.dec_conv3(cat_tens3)

        return d3
```

```python
model = UNet()
optimizer = optimizers.Adam(learning_rate=lr, decay=weight_decay)
loss_fn = losses.BinaryCrossentropy(from_logits=True)

model.compile(loss=loss_fn, optimizer=optimizer)
```

```python
train(((X_train, y_train), (X_test, y_test)), model, epochs, batch_size)
```

```python
predictions = []
image_mask = []
plots = 5

for i, (img, mask) in enumerate(zip(X_test, y_test)):
    if i == plots:
        break
    img = tf.expand_dims(img, 0)
    pred = np.array(model.predict(img))
    predictions.append(pred[0, :, :, 0] > 0.5)
    image_mask.append(mask)
plotn(plots, (predictions, image_mask))
```

## NLP

### Representing Text as Tensors

> **📖 章节概述**
>
> # Natural Language Processing
> 
> ![Summary of NLP tasks in a doodle](../sketchnotes/ai-nlp.png)
> 
> In this section, we will focus on using Neural Networks to handle tasks related to **Natural Language Processing (NLP)**. There are many NLP problems that we want computers to be able to solve:
> 
> * **Text classification** is a typical classification problem pertaining to text sequences. Examples include classifying e-mail messages as spam vs. no-spam, or categorizing articles as sport, business, politics, etc. Also, when developing chat bots, we often need to understand what a user wanted to say -- in this case we are dealing with **intent classification**. Often, in intent classification we need to deal with many categories.
> * **Sentiment analysis** is a typical regression problem, where we need to attribute a number (a sentiment) corresponding to how positive/negative the meaning of a sentence is. A more advanced version of sentiment analysis is **aspect-based sentiment analysis** (ABSA), where we attribute sentiment not to the whole sentence, but to different parts of it (aspects), eg. *In this restaurant, I liked the cuisine, but the atmosphere was awful*.
> * **Named Entity Recognition** (NER) refers to the problem of extracting certain entities from text. For example, we might need to understand that in the phrase *I need to fly to Paris tomorrow* the word *tomorrow* refers to DATE, and *Paris* is a LOCATION.  
> * **Keyword extraction** is similar to NER, but we need to extract words important to the meaning of the sentence automatically, without pre-training for specific entity types.
> * **Text clustering** can be useful when we want to group together similar sentences, for example, similar requests in technical support conversations.
> * **Question answering** refers to the ability of a model to answer a specific question. The model receives a text passage and a question as inputs, and it needs to provide a place in the text where the answer to the question is contained (or, sometimes, to generate the answer text).
> * **Text Generation** is the ability of a model to generate new text. It can be considered as classification task that predicts next letter/word based on some *text prompt*. Advanced text generation models, such as GPT-3, are able to solve other NLP tasks such as classification using a technique called [prompt programming](https://towardsdatascience.com/software-3-0-how-prompting-will-change-the-rules-of-the-game-a982fbfe1e0) or [prompt engineering](https://medium.com/swlh/openai-gpt-3-and-prompt-engineering-dcdc2c5fcd29)
> * **Text summarization** is a technique when we want a computer to "read" long text and summarize it in a few sentences.
> * **Machine translation** can be viewed as a combination of text understanding in one language, and text generation in another one.
> 
> Initially, most of NLP tasks were solved using traditional methods such as grammars. For example, in machine translation parsers were used to transform initial sentence into a syntax tree, then higher level semantic structures were extracted to represent the meaning of the sentence, and based on this meaning and grammar of the target language the result was generated. Nowadays, many NLP tasks are more effectively solved using neural networks.
> 
> > Many classical NLP methods are implemented in [Natural Language Processing Toolkit (NLTK)](https://www.nltk.org) Python library. There is a great [NLTK Book](https://www.nltk.org/book/) available online that covers how different NLP tasks can be solved using NLTK.
> 
> In our course, we will mostly focus on using Neural Networks for NLP, and we will use NLTK where needed.
> 
> We have already learned about using neural networks for dealing with tabular data and with images. The main difference between those types of data and text is that text is a sequence of variable length, while the input size in case of images is known in advance. While convolutional networks can extract patterns from input data, patterns in text are more complex. Eg., we can have negation being separated from the subject be arbitrary for many words (eg. *I do not like oranges*, vs. *I do not like those big colorful tasty oranges*), and that should still be interpreted as one pattern. Thus, to handle language we need to introduce new neural network types, such as *recurrent networks* and *transformers*.
> 
> ## Install Libraries
> 
> If you are using local Python installation to run this course, you may need to install all required libraries for NLP using the following commands:
> 
> **For PyTorch**
> ```bash
> pip install -r requirements-pytorch.txt
> ```
> **For TensorFlow**
> ```bash
> pip install -r requirements-tf.txt
> ```
> 
> > You can try NLP with TensorFlow on [Microsoft Learn](https://docs.microsoft.com/learn/modules/intro-natural-language-processing-tensorflow/?WT.mc_id=academic-77998-cacaste)
> 
> ## GPU Warning
> 
> In this section, in some of the examples we will be training quite large models.
> * **Use a GPU-Enabled Computer**: It's advisable to run your notebooks on a GPU-enabled computer to reduce waiting times when working with large models.
> * **GPU Memory Constraints**: Running on a GPU may lead to situations where you run out of GPU memory, especially when training large models.
> * **GPU Memory Consumption**: The amount of GPU memory consumed during training depends on various factors, including the minibatch size.
> * **Minimize Minibatch Size**: If you encounter GPU memory issues, consider reducing the minibatch size in your code as a potential solution.
> * **TensorFlow GPU Memory Release**: Older versions of TensorFlow may not release GPU memory correctly when training multiple models within one Python kernel. To manage GPU memory usage effectively, you can configure TensorFlow to allocate GPU memory only as needed.
> * **Code Inclusion**: To set TensorFlow to grow GPU memory allocation only when required, include the following code in your notebooks:
> 
> ```python
> physical_devices = tf.config.list_physical_devices('GPU') 
> if len(physical_devices)>0:
>     tf.config.experimental.set_memory_growth(physical_devices[0], True) 
> ```
> 
> If you're interested in learning about NLP from a classic ML perspective, visit [this suite of lessons](https://github.com/microsoft/ML-For-Beginners/tree/main/6-NLP)
> 
> ## In this Section
> In this section we will learn about:
> 
> * [Representing text as tensors](13-TextRep/README.md)
> * [Word Embeddings](14-Emdeddings/README.md)
> * [Language Modeling](15-LanguageModeling/README.md)
> * [Recurrent Neural Networks](16-RNN/README.md)
> * [Generative Networks](17-GenerativeNetworks/README.md)
> * [Transformers](18-Transformers/README.md)
> 

---

#### Text Classification

Throughout the first part of this section, we will focus on **text classification** task. We will use the [AG News](https://www.kaggle.com/amananandrai/ag-news-classification-dataset) Dataset, which contains news articles like the following:

* Category: Sci/Tech
* Title: Ky. Company Wins Grant to Study Peptides (AP)
* Body: AP - A company founded by a chemistry researcher at the University of Louisville won a grant to develop...

Our goal will be to classify the news item into one of the categories based on text.

#### Representing text

If we want to solve Natural Language Processing (NLP) tasks with neural networks, we need some way to represent text as tensors. Computers already represent textual characters as numbers that map to fonts on your screen using encodings such as ASCII or UTF-8.

<img alt="Image showing diagram mapping a character to an ASCII and binary representation" src="images/ascii-character-map.png" width="50%"/>

> [Image source](https://www.seobility.net/en/wiki/ASCII)

As humans, we understand what each letter **represents**, and how all characters come together to form the words of a sentence. However, computers by themselves do not have such an understanding, and neural network has to learn the meaning during training.

Therefore, we can use different approaches when representing text:

* **Character-level representation**, when we represent text by treating each character as a number. Given that we have *C* different characters in our text corpus, the word *Hello* would be represented by 5x*C* tensor. Each letter would correspond to a tensor column in one-hot encoding.
* **Word-level representation**, in which we create a **vocabulary** of all words in our text, and then represent words using one-hot encoding. This approach is somehow better, because each letter by itself does not have much meaning, and thus by using higher-level semantic concepts - words - we simplify the task for the neural network. However, given the large dictionary size, we need to deal with high-dimensional sparse tensors.

Regardless of the representation, we first need to convert the text into a sequence of **tokens**, one token being either a character, a word, or sometimes even part of a word. Then, we convert the token into a number, typically using **vocabulary**, and this number can be fed into a neural network using one-hot encoding.

#### N-Grams

In natural language, precise meaning of words can only be determined in context. For example, meanings of *neural network* and *fishing network* are completely different. One of the ways to take this into account is to build our model on pairs of words, and considering word pairs as separate vocabulary tokens. In this way, the sentence *I like to go fishing* will be represented by the following sequence of tokens: *I like*, *like to*, *to go*, *go fishing*. The problem with this approach is that the dictionary size grows significantly, and combinations like *go fishing* and *go shopping* are presented by different tokens, which do not share any semantic similarity despite the same verb.  

In some cases, we may consider using tri-grams -- combinations of three words -- as well. Thus the approach is such is often called **n-grams**. Also, it makes sense to use n-grams with character-level representation, in which case n-grams will roughly correspond to different syllabi.

#### Bag-of-Words and TF/IDF

When solving tasks like text classification, we need to be able to represent text by one fixed-size vector, which we will use as an input to final dense classifier. One of the simplest ways to do that is to combine all individual word representations, eg. by adding them. If we add one-hot encodings of each word, we will end up with a vector of frequencies, showing how many times each word appears inside the text. Such representation of text is called **bag of words** (BoW).

<img src="images/bow.png" width="90%"/>

> Image by the author

A BoW essentially represents which words appear in text and in which quantities, which can indeed be a good indication of what the text is about. For example, news article on politics is likely to contains words such as *president* and *country*, while scientific publication would have something like *collider*, *discovered*, etc. Thus, word frequencies can in many cases be a good indicator of text content.

The problem with BoW is that certain common words, such as *and*, *is*, etc. appear in most of the texts, and they have highest frequencies, masking out the words that are really important. We may lower the importance of those words by taking into account the frequency at which words occur in the whole document collection. This is the main idea behind TF/IDF approach, which is covered in more detail in the notebooks attached to this lesson.

However, none of those approaches can fully take into account the **semantics** of text. We need more powerful neural networks models to do this, which we will discuss later in this section.

#### ✍️ Exercises: Text Representation

Continue your learning in the following notebooks:

* [Text Representation with PyTorch](TextRepresentationPyTorch.ipynb)
* [Text Representation with TensorFlow](TextRepresentationTF.ipynb)

#### Conclusion

So far, we have studied techniques that can add frequency weight to different words. They are, however, unable to represent meaning or order. As the famous linguist J. R. Firth said in 1935, "The complete meaning of a word is always contextual, and no study of meaning apart from context can be taken seriously." We will learn later in the course how to capture contextual information from text using language modeling.

#### 🚀 Challenge

Try some other exercises using bag-of-words and different data models. You might be inspired by this [competition on Kaggle](https://www.kaggle.com/competitions/word2vec-nlp-tutorial/overview/part-1-for-beginners-bag-of-words)

#### Review & Self Study

Practice your skills with text embeddings and bag-of-words techniques on [Microsoft Learn](https://docs.microsoft.com/learn/modules/intro-natural-language-processing-pytorch/?WT.mc_id=academic-77998-cacaste)

#### [Assignment: Notebooks](assignment.md)

### Embeddings

When training classifiers based on BoW or TF/IDF, we operated on high-dimensional bag-of-words vectors with length `vocab_size`, and we were explicitly converting from low-dimensional positional representation vectors into sparse one-hot representation. This one-hot representation, however, is not memory-efficient. In addition, each word is treated independently from each other, i.e. one-hot encoded vectors do not express any semantic similarity between words.

The idea of **embedding** is to represent words by lower-dimensional dense vectors, which somehow reflect the semantic meaning of a word. We will later discuss how to build meaningful word embeddings, but for now let's just think of embeddings as a way to lower dimensionality of a word vector.

So, the embedding layer would take a word as an input, and produce an output vector of specified `embedding_size`. In a sense, it is very similar to a `Linear` layer, but instead of taking a one-hot encoded vector, it will be able to take a word number as an input, allowing us to avoid creating large one-hot-encoded vectors.

By using an embedding layer as a first layer in our classifier network, we can switch from a bag-of-words to **embedding bag** model, where we first convert each word in our text into corresponding embedding, and then compute some aggregate function over all those embeddings, such as `sum`, `average` or `max`.  

![Image showing an embedding classifier for five sequence words.](images/embedding-classifier-example.png)

> Image by the author

#### ✍️ Exercises: Embeddings

Continue your learning in the following notebooks:
* [Embeddings with PyTorch](EmbeddingsPyTorch.ipynb)
* [Embeddings TensorFlow](EmbeddingsTF.ipynb)

#### Semantic Embeddings: Word2Vec

While the embedding layer learned to map words to vector representation, however, this representation did not necessarily have much semantical meaning. It would be nice to learn a vector representation such that similar words or synonyms correspond to vectors that are close to each other in terms of some vector distance (eg. Euclidean distance).

To do that, we need to pre-train our embedding model on a large collection of text in a specific way. One way to train semantic embeddings is called [Word2Vec](https://en.wikipedia.org/wiki/Word2vec). It is based on two main architectures that are used to produce a distributed representation of words:

 - **Continuous bag-of-words** (CBoW) — in this architecture, we train the model to predict a word from surrounding context. Given the ngram $(W_{-2},W_{-1},W_0,W_1,W_2)$, the goal of the model is to predict $W_0$ from $(W_{-2},W_{-1},W_1,W_2)$.
 - **Continuous skip-gram** is opposite to CBoW. The model uses surrounding window of context words to predict the current word.

CBoW is faster, while skip-gram is slower, but does a better job of representing infrequent words.

![Image showing both CBoW and Skip-Gram algorithms to convert words to vectors.](./images/example-algorithms-for-converting-words-to-vectors.png)

> Image from [this paper](https://arxiv.org/pdf/1301.3781.pdf)

Word2Vec pre-trained embeddings (as well as other similar models, such as GloVe) can also be used in place of embedding layer in neural networks. However, we need to deal with vocabularies, because the vocabulary used to pre-train Word2Vec/GloVe is likely to differ from the vocabulary in our text corpus. Have a look into the above Notebooks to see how this problem can be resolved.

#### Contextual Embeddings

One key limitation of traditional pretrained embedding representations such as Word2Vec is the problem of word sense disambiguation. While pretrained embeddings can capture some of the meaning of words in context, every possible meaning of a word is encoded into the same embedding. This can cause problems in downstream models, since many words such as the word 'play' have different meanings depending on the context they are used in.

For example word 'play' in those two different sentences have quite different meaning:

- I went to a **play** at the theatre.
- John wants to **play** with his friends.

The pretrained embeddings above represent both of these meanings of the word 'play' in the same embedding. To overcome this limitation, we need to build embeddings based on the **language model**, which is trained on a large corpus of text, and *knows* how words can be put together in different contexts. Discussing contextual embeddings is out of scope for this tutorial, but we will come back to them when talking about language models later in the course.

#### Conclusion

In this lesson, you discovered how to build and use embedding layers in TensorFlow and Pytorch to better reflect the semantic meanings of words.

#### 🚀 Challenge

Word2Vec has been used for some interesting applications, including generating song lyrics and poetry. Take a look at [this article](https://www.politetype.com/blog/word2vec-color-poems) which walks through how the author used Word2Vec to generate poetry. Watch [this video by Dan Shiffmann](https://www.youtube.com/watch?v=LSS_bos_TPI&ab_channel=TheCodingTrain) as well to discover a different explanation of this technique. Then try to apply these techniques to your own text corpus, perhaps sourced from Kaggle.

#### Review & Self Study

Read through this paper on Word2Vec: [Efficient Estimation of Word Representations in Vector Space](https://arxiv.org/pdf/1301.3781.pdf)

#### [Assignment: Notebooks](assignment.md)

---

**🔧 练习**（来自 `lessons/5-NLP/15-LanguageModeling/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

In this lab, you we challenge you to train Word2Vec model using Skip-Gram technique. Train a network with embedding to predict neighboring words in $N$-tokens-wide Skip-Gram window. You can use the [code from this lesson](../CBoW-TF.ipynb), and slightly modify it.

#### The Dataset

You are welcome to use any book. You can find a lot of free texts at [Project Gutenberg](https://www.gutenberg.org/), for example, here is a direct link to [Alice's Adventures in Wonderland](https://www.gutenberg.org/files/11/11-0.txt)) by Lewis Carroll. Or, you can use Shakespeare's plays, which you can get using the following code:

```python
path_to_file = tf.keras.utils.get_file(
   'shakespeare.txt', 
   'https://storage.googleapis.com/download.tensorflow.org/data/shakespeare.txt')
text = open(path_to_file, 'rb').read().decode(encoding='utf-8')
```

#### Explore!

If you have time and want to get deeper into the subject, try to explore several things:

* How does embedding size affects the results?
* How does different text styles affect the result?
* Take several very different types of words and their synonyms, obtain their vector representations, apply PCA to reduce dimensions to 2, and plot them in 2D space. Do you see any patterns?

### Language Modeling

Semantic embeddings, such as Word2Vec and GloVe, are in fact a first step towards **language modeling** - creating models that somehow *understand* (or *represent*) the nature of the language.

The main idea behind language modeling is training them on unlabeled datasets in an unsupervised manner. This is important because we have huge amounts of unlabeled text available, while the amount of labeled text would always be limited by the amount of effort we can spend on labeling. Most often, we can build language models that can **predict missing words** in the text, because it is easy to mask out a random word in text and use it as a training sample.

#### Training Embeddings

In our previous examples, we used pre-trained semantic embeddings, but it is interesting to see how those embeddings can be trained. There are several possible ideas the can be used:

* **N-Gram** language modeling, when we predict a token by looking at N previous tokens (N-gram)
* **Continuous Bag-of-Words** (CBoW), when we predict the middle token $W_0$ in a token sequence $W_{-N}$, ..., $W_N$.
* **Skip-gram**, where we predict a set of neighboring tokens {$W_{-N},\dots, W_{-1}, W_1,\dots, W_N$} from the middle token $W_0$.

![image from paper on converting words to vectors](../14-Embeddings/images/example-algorithms-for-converting-words-to-vectors.png)

> Image from [this paper](https://arxiv.org/pdf/1301.3781.pdf)

#### ✍️ Example Notebooks: Training CBoW model

Continue your learning in the following notebooks:

* [Training CBoW Word2Vec with TensorFlow](CBoW-TF.ipynb)
* [Training CBoW Word2Vec with PyTorch](CBoW-PyTorch.ipynb)

#### Conclusion

In the previous lesson we have seen that words embeddings work like magic! Now we know that training word embeddings is not a very complex task, and we should be able to train our own word embeddings for domain specific text if needed. 

#### Review & Self Study

* [Official PyTorch tutorial on Language Modeling](https://pytorch.org/tutorials/beginner/nlp/word_embeddings_tutorial.html).
* [Official TensorFlow tutorial on training Word2Vec model](https://www.TensorFlow.org/tutorials/text/word2vec).
* Using the **gensim** framework to train most commonly used embeddings in a few lines of code is described [in this documentation](https://pytorch.org/tutorials/beginner/nlp/word_embeddings_tutorial.html).

#### 🚀 [Assignment: Train Skip-Gram Model](lab/README.md)

In the lab, we challenge you to modify the code from this lesson to train skip-gram model instead of CBoW. [Read the details](lab/README.md)

### Recurrent Neural Networks

In previous sections, we have been using rich semantic representations of text and a simple linear classifier on top of the embeddings. What this architecture does is to capture the aggregated meaning of words in a sentence, but it does not take into account the **order** of words, because the aggregation operation on top of embeddings removed this information from the original text. Because these models are unable to model word ordering, they cannot solve more complex or ambiguous tasks such as text generation or question answering.

To capture the meaning of text sequence, we need to use another neural network architecture, which is called a **recurrent neural network**, or RNN. In RNN, we pass our sentence through the network one symbol at a time, and the network produces some **state**, which we then pass to the network again with the next symbol.

![RNN](./images/rnn.png)

> Image by the author

Given the input sequence of tokens X<sub>0</sub>,...,X<sub>n</sub>, RNN creates a sequence of neural network blocks, and trains this sequence end-to-end using backpropagation. Each network block takes a pair (X<sub>i</sub>,S<sub>i</sub>) as an input, and produces S<sub>i+1</sub> as a result. The final state S<sub>n</sub> or (output Y<sub>n</sub>) goes into a linear classifier to produce the result. All the network blocks share the same weights, and are trained end-to-end using one backpropagation pass.

Because state vectors S<sub>0</sub>,...,S<sub>n</sub> are passed through the network, it is able to learn the sequential dependencies between words. For example, when the word *not* appears somewhere in the sequence, it can learn to negate certain elements within the state vector, resulting in negation.

> ✅ Since the weights of all RNN blocks on the picture above are shared, the same picture can be represented as one block (on the right) with a recurrent feedback loop, which passes the output state of the network back to the input.

#### Anatomy of an RNN Cell

Let's see how a simple RNN cell is organized. It accepts the previous state S<sub>i-1</sub> and current symbol X<sub>i</sub> as inputs, and has to produce the output state S<sub>i</sub> (and, sometimes, we are also interested in some other output Y<sub>i</sub>, as in the case with generative networks).

A simple RNN cell has two weight matrices inside: one transforms an input symbol (let's call it W), and another one transforms an input state (H). In this case the output of the network is calculated as &sigma;(W&times;X<sub>i</sub>+H&times;S<sub>i-1</sub>+b), where &sigma; is the activation function and b is additional bias.

<img alt="RNN Cell Anatomy" src="images/rnn-anatomy.png" width="50%"/>

> Image by the author

In many cases, input tokens are passed through the embedding layer before entering the RNN to lower the dimensionality. In this case, if the dimension of the input vectors is *emb_size*, and state vector is *hid_size* - the size of W is *emb_size*&times;*hid_size*, and the size of H is *hid_size*&times;*hid_size*.

#### Long Short Term Memory (LSTM)

One of the main problems of classical RNNs is the so-called **vanishing gradients** problem. Because RNNs are trained end-to-end in one backpropagation pass, it has difficulty propagating error to the first layers of the network, and thus the network cannot learn relationships between distant tokens. One of the ways to avoid this problem is to introduce **explicit state management** by using so called **gates**. There are two well-known architectures of this kind: **Long Short Term Memory** (LSTM) and **Gated Relay Unit** (GRU).

![Image showing an example long short term memory cell](./images/long-short-term-memory-cell.svg)

> Image source TBD

The LSTM Network is organized in a manner similar to RNN, but there are two states that are being passed from layer to layer: the actual state C, and the hidden vector H. At each unit, the hidden vector H<sub>i</sub> is concatenated with input X<sub>i</sub>, and they control what happens to the state C via **gates**. Each gate is a neural network with sigmoid activation (output in the range [0,1]), which can be thought of as a bitwise mask when multiplied by the state vector. There are the following gates (from left to right on the picture above):

* The **forget gate** takes a hidden vector and determines which components of the vector C we need to forget, and which to pass through.
* The **input gate** takes some information from the input and hidden vectors and inserts it into state.
* The **output gate** transforms state via a linear layer with *tanh* activation, then selects some of its components using a hidden vector H<sub>i</sub> to produce a new state C<sub>i+1</sub>.

Components of the state C can be thought of as some flags that can be switched on and off. For example, when we encounter a name *Alice* in the sequence, we may want to assume that it refers to a female character, and raise the flag in the state that we have a female noun in the sentence. When we further encounter phrases *and Tom*, we will raise the flag that we have a plural noun. Thus by manipulating state we can supposedly keep track of the grammatical properties of sentence parts.

> ✅ An excellent resource for understanding the internals of LSTM is this great article [Understanding LSTM Networks](https://colah.github.io/posts/2015-08-Understanding-LSTMs/) by Christopher Olah.

#### Bidirectional and Multilayer RNNs

We have discussed recurrent networks that operate in one direction, from beginning of a sequence to the end. It looks natural, because it resembles the way we read and listen to speech. However, since in many practical cases we have random access to the input sequence, it might make sense to run recurrent computation in both directions. Such networks are call **bidirectional** RNNs. When dealing with bidirectional network, we would need two hidden state vectors, one for each direction.

A Recurrent network, either one-directional or bidirectional, captures certain patterns within a sequence, and can store them into a state vector or pass into output. As with convolutional networks, we can build another recurrent layer on top of the first one to capture higher level patterns and build from low-level patterns extracted by the first layer. This leads us to the notion of a **multi-layer RNN** which consists of two or more recurrent networks, where the output of the previous layer is passed to the next layer as input.

![Image showing a Multilayer long-short-term-memory- RNN](./images/multi-layer-lstm.jpg)

*Picture from [this wonderful post](https://towardsdatascience.com/from-a-lstm-cell-to-a-multilayer-lstm-network-with-pytorch-2899eb5696f3) by Fernando López*

#### ✍️ Exercises: Embeddings

Continue your learning in the following notebooks:

* [RNNs with PyTorch](RNNPyTorch.ipynb)
* [RNNs with TensorFlow](RNNTF.ipynb)

#### Conclusion

In this unit, we have seen that RNNs can be used for sequence classification, but in fact, they can handle many more tasks, such as text generation, machine translation, and more. We will consider those tasks in the next unit.

#### 🚀 Challenge

Read through some literature about LSTMs and consider their applications:

- [Grid Long Short-Term Memory](https://arxiv.org/pdf/1507.01526v1.pdf)
- [Show, Attend and Tell: Neural Image Caption
Generation with Visual Attention](https://arxiv.org/pdf/1502.03044v2.pdf)

#### Review & Self Study

- [Understanding LSTM Networks](https://colah.github.io/posts/2015-08-Understanding-LSTMs/) by Christopher Olah.

#### [Assignment: Notebooks](assignment.md)

---

**🔧 练习**（来自 `lessons/5-NLP/17-GenerativeNetworks/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

In this lab, you need to take any book, and use it as a dataset to train word-level text generator.

#### The Dataset

You are welcome to use any book. You can find a lot of free texts at [Project Gutenberg](https://www.gutenberg.org/), for example, here is a direct link to [Alice's Adventures in Wonderland](https://www.gutenberg.org/files/11/11-0.txt)) by Lewis Carroll.

### Generative networks

Recurrent Neural Networks (RNNs) and their gated cell variants such as Long Short Term Memory Cells (LSTMs) and Gated Recurrent Units (GRUs) provided a mechanism for language modeling in that they can learn word ordering and provide predictions for the next word in a sequence. This allows us to use RNNs for **generative tasks**, such as ordinary text generation, machine translation, and even image captioning.

> ✅ Think about all the times you've benefited from generative tasks such as text completion as you type. Do some research into your favorite applications to see if they leveraged RNNs.

In RNN architecture we discussed in the previous unit, each RNN unit produced the next hidden state as an output. However, we can also add another output to each recurrent unit, which would allow us to output a **sequence** (which is equal in length to the original sequence). Moreover, we can use RNN units that do not accept an input at each step, and just take some initial state vector, and then produce a sequence of outputs.

This allows for different neural architectures that are shown in the picture below:

![Image showing common recurrent neural network patterns.](images/unreasonable-effectiveness-of-rnn.jpg)

> Image from blog post [Unreasonable Effectiveness of Recurrent Neural Networks](http://karpathy.github.io/2015/05/21/rnn-effectiveness/) by [Andrej Karpaty](http://karpathy.github.io/)

* **One-to-one** is a traditional neural network with one input and one output
* **One-to-many** is a generative architecture that accepts one input value, and generates a sequence of output values. For example, if we want to train an **image captioning** network that would produce a textual description of a picture, we can a picture as input, pass it through a CNN to obtain its hidden state, and then have a recurrent chain generate caption word-by-word
* **Many-to-one** corresponds to the RNN architectures we described in the previous unit, such as text classification
* **Many-to-many**, or **sequence-to-sequence** corresponds to tasks such as **machine translation**, where we have first RNN collect all information from the input sequence into the hidden state, and another RNN chain unrolls this state into the output sequence.

In this unit, we will focus on simple generative models that help us generate text. For simplicity, we will use character-level tokenization.

We will train this RNN to generate text step by step. On each step, we will take a sequence of characters of length `nchars`, and ask the network to generate the next output character for each input character:

![Image showing an example RNN generation of the word 'HELLO'.](images/rnn-generate.png)

When generating text (during inference), we start with some **prompt**, which is passed through RNN cells to generate its intermediate state, and then from this state the generation starts. We generate one character at a time, and pass the state and the generated character to another RNN cell to generate the next one, until we generate enough characters.

<img src="images/rnn-generate-inf.png" width="60%"/>

> Image by the author

#### ✍️ Exercises: Generative Networks

Continue your learning in the following notebooks:

* [Generative Networks with PyTorch](GenerativePyTorch.ipynb)
* [Generative Networks with TensorFlow](GenerativeTF.ipynb)

#### Soft text generation and temperature

The output of each RNN cell is a probability distribution of characters. If we always take the character with the highest probability as the next character in generated text, the text often can become "cycled" between the same character sequences again and again, like in this example:

```
today of the second the company and a second the company ...
```

However, if we look at the probability distribution for the next character, it could be that the difference between a few highest probabilities is not huge, e.g. one character can have probability 0.2, another - 0.19, etc. For example, when looking for the next character in the sequence '*play*', next character can equally well be either space, or **e** (as in the word *player*).

This leads us to the conclusion that it is not always "fair" to select the character with a higher probability, because choosing the second highest might still lead us to meaningful text. It is more wise to **sample** characters from the probability distribution given by the network output. We can also use a parameter, **temperature**, that will flatten out the probability distribution, in case we want to add more randomness, or make it more steep, if we want to stick more to the highest-probability characters.

Explore how this soft text generation is implemented in the notebooks linked above.

#### Conclusion

While text generation may be useful in its own right, the major benefits come from the ability to generate text using RNNs from some initial feature vector. For example, text generation is used as part of machine translation (sequence-to-sequence, in this case state vector from *encoder* is used to generate or *decode* translated message), or generating textual description of an image (in which case the feature vector would come from CNN extractor).

#### 🚀 Challenge

Take some lessons on Microsoft Learn on this topic

* Text Generation with [PyTorch](https://docs.microsoft.com/learn/modules/intro-natural-language-processing-pytorch/6-generative-networks/?WT.mc_id=academic-77998-cacaste)/[TensorFlow](https://docs.microsoft.com/learn/modules/intro-natural-language-processing-tensorflow/5-generative-networks/?WT.mc_id=academic-77998-cacaste)

#### Review & Self Study

Here are some articles to expand your knowledge

* Different approaches to text generation with Markov Chain, LSTM and GPT-2: [blog post](https://towardsdatascience.com/text-generation-gpt-2-lstm-markov-chain-9ea371820e1e)
* Text generation sample in [Keras documentation](https://keras.io/examples/generative/lstm_character_level_text_generation/)

### Positional Encoding/Embedding

The idea of positional encoding is the following. 
1. When using RNNs, the relative position of the tokens is represented by the number of steps, and thus does not need to be explicitly represented. 
2. However, once we switch to attention, we need to know the relative positions of tokens within a sequence. 
3. To get positional encoding, we augment our sequence of tokens with a sequence of token positions in the sequence (i.e., a sequence of numbers 0,1, ...).
4. We then mix the token position with a token embedding vector. To transform the position (integer) into a vector, we can use different approaches:

* Trainable embedding, similar to token embedding. This is the approach we consider here. We apply embedding layers on top of both tokens and their positions, resulting in embedding vectors of the same dimensions, which we then add together.
* Fixed position encoding function, as proposed in the original paper.

<img src="images/pos-embedding.png" width="50%"/>

> Image by the author

The result that we get with positional embedding embeds both the original token and its position within a sequence.

### Multi-Head Self-Attention

Next, we need to capture some patterns within our sequence. To do this, transformers use a **self-attention** mechanism, which is essentially attention applied to the same sequence as the input and output. Applying self-attention allows us to take into account **context** within the sentence, and see which words are inter-related. For example, it allows us to see which words are referred to by coreferences, such as *it*, and also take the context into account:

![](images/CoreferenceResolution.png)

> Image from the [Google Blog](https://research.googleblog.com/2017/08/transformer-novel-neural-network.html)

In transformers, we use **Multi-Head Attention** in order to give the network the power to capture several different types of dependencies, eg. long-term vs. short-term word relations, co-reference vs. something else, etc.

[TensorFlow Notebook](TransformersTF.ipynb) contains more detains on the implementation of transformer layers.

### Encoder-Decoder Attention

In transformers, attention is used in two places:

* To capture patterns within the input text using self-attention
* To perform sequence translation - it is the attention layer between encoder and decoder.

Encoder-decoder attention is very similar to the attention mechanism used in RNNs, as described in the beginning of this section. This animated diagram explains the role of encoder-decoder attention.

![Animated GIF showing how the evaluations are performed in transformer models.](./images/transformer-animated-explanation.gif)

Since each input position is mapped independently to each output position, transformers can parallelize better than RNNs, which enables much larger and more expressive language models. Each attention head can be used to learn different relationships between words that improves downstream Natural Language Processing tasks.

---

**🔧 练习**（来自 `lessons/5-NLP/19-NER/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

In this lab, you need to train named entity recognition model for medical terms.

#### The Dataset

To train NER model, we need properly labeled dataset with medical entities. [BC5CDR dataset](https://biocreative.bioinformatics.udel.edu/tasks/biocreative-v/track-3-cdr/) contains labeled diseases and chemicals entities from more than 1500 papers. You may download the dataset after registering at their web site.

BC5CDR Dataset looks like this:

```
6794356|t|Tricuspid valve regurgitation and lithium carbonate toxicity in a newborn infant.
6794356|a|A newborn with massive tricuspid regurgitation, atrial flutter, congestive heart failure, and a high serum lithium level is described. This is the first patient to initially manifest tricuspid regurgitation and atrial flutter, and the 11th described patient with cardiac disease among infants exposed to lithium compounds in the first trimester of pregnancy. Sixty-three percent of these infants had tricuspid valve involvement. Lithium carbonate may be a factor in the increasing incidence of congenital heart disease when taken during early pregnancy. It also causes neurologic depression, cyanosis, and cardiac arrhythmia when consumed prior to delivery.
6794356	0	29	Tricuspid valve regurgitation	Disease	D014262
6794356	34	51	lithium carbonate	Chemical	D016651
6794356	52	60	toxicity	Disease	D064420
...
```

In this dataset, there are paper title and abstract in the first two lines, and then there are individual entities, with beginning and end positions within title+abstract block. In addition to entity type, you get the ontology ID of this entity within some medical ontology.

You will need to write some Python code to convert this into BIO encoding.

#### The Network

First attempt at NER can be done by using LSTM network, as in our example you have seen during the lesson. However, in NLP tasks, [transformer architecture](https://en.wikipedia.org/wiki/Transformer_(machine_learning_model)), and specifically [BERT language models](https://en.wikipedia.org/wiki/BERT_(language_model)) show much better results. Pre-trained BERT models understand the general structure of a language, and can be fine-tuned for specific tasks with relatively small datasets and computational costs.

Since we are planning to apply NER to medical scenario, it makes sense to use BERT model trained on medical texts. Microsoft Research has released a pre-trained a model called [PubMedBERT][PubMedBERT] ([publication][PubMedBERT-Pub]), which was fine-tuned using texts from [PubMed](https://pubmed.ncbi.nlm.nih.gov/) repository.

The *de facto* standard for training transformer models is [Hugging Face Transformers](https://huggingface.co/) library. It also contains a repository of community-maintained pre-trained models, including PubMedBERT. To load and use this model, we just need a couple of lines of code:

```python
model_name = "microsoft/BiomedNLP-PubMedBERT-base-uncased-abstract"
classes = ... # number of classes: 2*entities+1
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = BertForTokenClassification.from_pretrained(model_name, classes)
```

This gives us the `model` itself, built for token classification task using `classes` number of classes, as well as `tokenizer` object that can split input text into tokens. You will need to convert the dataset into BIO format, taking PubMedBERT tokenization into account. You can use [this bit of Python code](https://gist.github.com/shwars/580b55684be3328eb39ecf01b9cbbd88) as an inspiration.

#### Takeaway

This task is very close to the actual task you are likely go have if you want to gain more insights into large volumes on natural language texts. In our case, we can apply our trained model to the [dataset of COVID-related papers](https://www.kaggle.com/allen-institute-for-ai/CORD-19-research-challenge) and see which insights we will be able to get. [This blog post](https://soshnikov.com/science/analyzing-medical-papers-with-azure-and-text-analytics-for-health/) and [this paper](https://www.mdpi.com/2504-2289/6/1/4) describe the research the can be done on this corpus of papers using NER.

### Named Entity Recognition

Up to now, we have mostly been concentrating on one NLP task - classification. However, there are also other NLP tasks that can be accomplished with neural networks. One of those tasks is **[Named Entity Recognition](https://wikipedia.org/wiki/Named-entity_recognition)** (NER), which deals with recognizing specific entities within text, such as places, person names, date-time intervals, chemical formulae and so on.

#### Example of Using NER

Suppose you want to develop a natural language chat bot, similar to Amazon Alexa or Google Assistant. The way intelligent chat bots work is to *understand* what the user wants by doing text classification on the input sentence. The result of this classification is so-called **intent**, which determines what a chat bot should do.

<img alt="Bot NER" src="images/bot-ner.png" width="50%"/>

> Image by the author

However, a user may provide some parameters as part of the phrase. For example, when asking for the weather, she may specify a location or date. A bot should be able to understand those entities, and fill in the parameter slots accordingly before performing the action. This is exactly where NER comes in.

> ✅ Another example would be [analyzing scientific medical papers](https://soshnikov.com/science/analyzing-medical-papers-with-azure-and-text-analytics-for-health/). One of the main things we need to look for are specific medical terms, such as diseases and medical substances. While a small number of diseases can probably be extracted using substring search, more complex entities, such as chemical compounds and medication names, need a more complex approach.

#### NER as Token Classification

NER models are essentially **token classification models**, because for each of the input tokens we need to decide whether it belongs to an entity or not, and if it does - to which entity class.

Consider the following paper title:

**Tricuspid valve regurgitation** and **lithium carbonate** **toxicity** in a newborn infant.

Entities here are:

* Tricuspid valve regurgitation is a disease (`DIS`)
* Lithium carbonate is a chemical substance (`CHEM`)
* Toxicity is also a disease (`DIS`)

Notice that one entity can span several tokens. And, as in this case, we need to distinguish between two consecutive entities. Thus, it is common to use two classes for each entity - one specifying the first token of the entity (often the `B-` prefix is used, for **b**eginning), and another - the continuation of an entity (`I-`, for **i**nner token). We also use `O` as a class to represent all **o**ther tokens. Such token tagging is called [BIO tagging](https://en.wikipedia.org/wiki/Inside%E2%80%93outside%E2%80%93beginning_(tagging)) (or IOB). When tagged, our title will look like this:

Token | Tag
------|-----
Tricuspid | B-DIS
valve | I-DIS
regurgitation | I-DIS
and | O
lithium | B-CHEM
carbonate | I-CHEM
toxicity | B-DIS
in | O
a | O
newborn | O
infant | O
. | O

Since we need to build a one-to-one correspondence between tokens and classes, we can train a rightmost **many-to-many** neural network model from this picture:

![Image showing common recurrent neural network patterns.](../17-GenerativeNetworks/images/unreasonable-effectiveness-of-rnn.jpg)

> *Image from [this blog post](http://karpathy.github.io/2015/05/21/rnn-effectiveness/) by [Andrej Karpathy](http://karpathy.github.io/). NER token classification models correspond to the right-most network architecture on this picture.*

#### Training NER models

Since a NER model is essentially a token classification model, we can use RNNs that we are already familiar with for this task. In this case, each block of recurrent network will return the token ID. The following example notebook shows how to train LSTM for token classification.

#### ✍️ Example Notebooks: NER

Continue your learning in the following notebook:

* [NER with TensorFlow](NER-TF.ipynb)

#### Conclusion

A NER model is a **token classification model**, which means that it can be used to perform token classification. This is a very common task in NLP, helping to recognize specific entities within text including places, names, dates, and more.

#### 🚀 Challenge

Complete the assignment linked below to train a named entity recognition model for medical terms, then try it on a different dataset.

#### Review & Self Study

Read through the blog [The Unreasonable Effectiveness of Recurrent Neural Networks](http://karpathy.github.io/2015/05/21/rnn-effectiveness/) and follow along with the Further Reading section in that article to deepen your knowledge.

### Pre-Trained Large Language Models

In all of our previous tasks, we were training a neural network to perform a certain task using labeled dataset. With large transformer models, such as BERT, we use language modelling in self-supervised fashion to build a language model, which is then specialized for specific downstream task with further domain-specific training. However, it has been demonstrated that large language models can also solve many tasks without ANY domain-specific training. A family of models capable of doing that is called **GPT**: Generative Pre-Trained Transformer.

#### Text Generation and Perplexity

The idea of a neural network being able to do general tasks without downstream training is presented in [Language Models are Unsupervised Multitask Learners](https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf) paper. The main idea is the many other tasks can be modeled using **text generation**, because understanding text essentially means being able to produce it. Because the model is trained on a huge amount of text that encompasses human knowledge, it also becomes knowledgeable about wide variety of subjects.

> Understanding and being able to produce text also entails knowing something about the world around us. People  also learn by reading to the large extent, and GPT network is similar in this respect.

Text generation networks work by predicting probability of the next word $$P(w_N)$$ However, unconditional probability of the next word equals to the frequency of the this word in the text corpus. GPT is able to give us **conditional probability** of the next word, given the previous ones: $$P(w_N | w_{n-1}, ..., w_0)$$

> You can read more about probabilities in our [Data Science for Beginers Curriculum](https://github.com/microsoft/Data-Science-For-Beginners/tree/main/1-Introduction/04-stats-and-probability)

Quality of language generating model can be defined using **perplexity**. It is intrinsic metric that allows us to measure the model quality without any task-specific dataset. It is based on the notion of *probability of a sentence* - the model assigns high probability to a sentence that is likely to be real (i.e. the model is not **perplexed** by it), and low probability to sentences that make less sense (eg. *Can it does what?*). When we give our model sentences from real text corpus, we would expect them to have high probability, and low **perplexity**. Mathematically, it is defined as normalized inverse probability of the test set:
$$
\mathrm{Perplexity}(W) = \sqrt[N]{1\over P(W_1,...,W_N)}
$$ 

**You can experiment with text generation using [GPT-powered text editor from Hugging Face](https://transformer.huggingface.co/doc/gpt2-large)**. In this editor, you start writing your text, and pressing **[TAB]** will offer you several completion options. If they are too short, or you are not satisfied with them - press [TAB] again, and you will have more options, including longer pieces of text.

#### GPT is a Family

GPT is not a single model, but rather a collection of models developed and trained by [OpenAI](https://openai.com). 

Under the GPT models, we have:

| [GPT-2](https://huggingface.co/docs/transformers/model_doc/gpt2#openai-gpt2) | [GPT 3](https://openai.com/research/language-models-are-few-shot-learners) | [GPT-4](https://openai.com/gpt-4) |
| -- | -- | -- |
|Language model with upto 1.5 billion parameters. | Language model with up to 175 billion parameters | 100T parameters and accepts both image and text inputs and outputs text. |

The GPT-3 and GPT-4 models are available [as a cognitive service from Microsoft Azure](https://azure.microsoft.com/en-us/services/cognitive-services/openai-service/#overview?WT.mc_id=academic-77998-cacaste), and as [OpenAI API](https://openai.com/api/).

#### Prompt Engineering

Because GPT has been trained on a vast volumes of data to understand language and code, they provide outputs in response to inputs (prompts). Prompts are GPT inputs or queries whereby one provides instructions to models on tasks they next completed. To elicit a desired outcome, you need the most effective prompt which involves selecting the right words, formats, phrases or even symbols. This approach is [Prompt Engineering](https://learn.microsoft.com/en-us/shows/ai-show/the-basics-of-prompt-engineering-with-azure-openai-service?WT.mc_id=academic-77998-bethanycheum)

[This documentation](https://learn.microsoft.com/en-us/semantic-kernel/prompt-engineering/?WT.mc_id=academic-77998-bethanycheum) provides you with more information on prompt engineering.

#### ✍️ Example Notebook: [Playing with OpenAI-GPT](GPT-PyTorch.ipynb)

Continue your learning in the following notebooks:

* [Generating text with OpenAI-GPT and Hugging Face Transformers](GPT-PyTorch.ipynb)

#### Conclusion

New general pre-trained language models do not only model language structure, but also contain vast amount of natural language. Thus, they can be effectively used to solve some NLP tasks in zero-shop or few-shot settings.

## Other

### Genetic Algorithms

**Genetic Algorithms** (GA) are based on an **evolutionary approach** to AI, in which methods of the evolution of a population is used to obtain an optimal solution for a given problem. They were proposed in 1975 by [John Henry Holland](https://wikipedia.org/wiki/John_Henry_Holland).

Genetic Algorithms are based on the following ideas:

* Valid solutions to the problem can be represented as **genes**
* **Crossover** allows us to combine two solutions together to obtain a new valid solution
* **Selection** is used to select more optimal solutions using some **fitness function**
* **Mutations** are introduced to destabilize optimization and get us out of the local minimum

If you want to implement a Genetic Algorithm, you need the following:

 * To find a method of coding our problem solutions using **genes** g&in;&Gamma;
 * On the set of genes &Gamma; we need to define **fitness function** fit: &Gamma;&rightarrow;**R**. Smaller function values correspond to better solutions.
 * To define **crossover** mechanism to combine two genes together to get a new valid solution crossover: &Gamma;<sup>2</sub>&rightarrow;&Gamma;.
 * To define **mutation** mechanism mutate: &Gamma;&rightarrow;&Gamma;.

In many cases, crossover and mutation are quite simple algorithms to manipulate genes as numeric sequences or bit vectors.

The specific implementation of a genetic algorithm can vary from case to case, but the overall structure is the following:

1. Select an initial population G&subset;&Gamma;
2. Randomly select one of the operations that will be performed at this step: crossover or mutation
3. **Crossover**:
  * Randomly select two genes g<sub>1</sub>, g<sub>2</sub> &in; G
  * Compute crossover g=crossover(g<sub>1</sub>,g<sub>2</sub>)
  * If fit(g)<fit(g<sub>1</sub>) or fit(g)<fit(g<sub>2</sub>) - replace corresponding gene in the population by g.
4. **Mutation** - select random gene g&in;G and replace it by mutate(g)
5. Repeat from step 2, until we get a sufficiently small value of fit, or until the limit on the number of steps is reached.

#### Typical Tasks

Tasks typically solved by Genetic Algorithms include:

1. Schedule optimization
1. Optimal packing
1. Optimal cutting
1. Speeding up exhaustive search

#### ✍️ Exercises: Genetic Algorithms

Continue your learning in the following notebooks:

Go to [this notebook](Genetic.ipynb) to see two examples of using Genetic Algorithms:

1. Fair division of treasure
1. 8 Queens Problem

#### Conclusion

Genetic Algorithms are used to solve many problems, including logistics and search problems. The field is Inspired by research that merged topics in Psychology and Computer Science. 

#### 🚀 Challenge

"Genetic algorithms are simple to implement, but their behavior is difficult to understand." [source](https://wikipedia.org/wiki/Genetic_algorithm) Do some research to find an implementation of a genetic algorithm such as solving a Sudoku puzzle, and explain how it works as a sketch or flowchart.

#### Review & Self Study

Watch [this great video](https://www.youtube.com/watch?v=qv6UVOQ0F44) talking about how computer can learn to play Super Mario using neural networks trained by genetic algorithms. We will learn more about computer learning to play games like that [in the next section](../22-DeepRL/README.md).

#### [Assignment: Diophantine Equation](Diophantine.ipynb)

Your goal is to solve so-called **Diophantine equation** - an equation with integer roots. For example, consider the equation a+2b+3c+4d=30. You need to find the integer roots that satisfy this equation.

*This assignment is inspired by [this post](https://habr.com/post/128704/).*

Hints:

1. You can consider roots to be in the interval [0;30]
1. As a gene, consider using the list of root values

Use [Diophantine.ipynb](Diophantine.ipynb) as a starting point.

---

**📓 Notebook 代码**（来自 `lessons/6-Other/22-DeepRL/CartPole-RL-PyTorch.ipynb`）:

This notebooks is part of [AI for Beginners Curriculum](http://aka.ms/ai-beginners). It has been inspired by [official PyTorch tutorial](https://pytorch.org/tutorials/intermediate/reinforcement_q_learning.html) and [this Cartpole PyTorch implementation](https://github.com/yc930401/Actor-Critic-pytorch).

In this example, we will use RL to train a model to balance a pole on a cart that can move left and right on horizontal scale. We will use [OpenAI Gym](https://www.gymlibrary.ml/) environment to simulate the pole.

> **Note**: You can run this lesson's code locally (eg. from Visual Studio Code), in which case the simulation will open in a new window. When running the code online, you may need to make some tweaks to the code, as described [here](https://towardsdatascience.com/rendering-openai-gym-envs-on-binder-and-google-colab-536f99391cc7).

We will start by making sure Gym is installed:

```python
import sys
!{sys.executable} -m pip install gym
```

Now let's create the CartPole environment and see how to operate on it. An environment has the following properties:

* **Action space** is the set of possible actions that we can perform at each step of the simulation
* **Observation space** is the space of observations that we can make

```python
import gym

env = gym.make("CartPole-v1")

print(f"Action space: {env.action_space}")
print(f"Observation space: {env.observation_space}")
```

Let's see how the simulation works. The following loop runs the simulation, until `env.step` does not return the termination flag `done`. We will randomly chose actions using `env.action_space.sample()`, which means the experiment will probably fail very fast (CartPole environment terminates when the speed of CartPole, its position or angle are outside certain limits).

> Simulation will open in the new window. You can run the code several times and see how it behaves.

```python
env.reset()

done = False
total_reward = 0
while not done:
   env.render()
   obs, rew, done, info = env.step(env.action_space.sample())
   total_reward += rew
   print(f"{obs} -> {rew}")
print(f"Total reward: {total_reward}")
```

Youn can notice that observations contain 4 numbers. They are:
- Position of cart
- Velocity of cart
- Angle of pole
- Rotation rate of pole

`rew` is the reward we receive at each step. You can see that in CartPole environment you are rewarded 1 point for each simulation step, and the goal is to maximize total reward, i.e. the time CartPole is able to balance without falling.

During reinforcement learning, our goal is to train a **policy** $\pi$, that for each state $s$ will tell us which action $a$ to take, so essentially $a = \pi(s)$.

If you want probabilistic solution, you can think of policy as returning a set of probabilities for each action, i.e. $\pi(a|s)$ would mean a probability that we should take action $a$ at state $s$.

#### Policy Gradient Method

In simplest RL algorithm, called **Policy Gradient**, we will train a neural network to predict the next action.

```python
import numpy as np
import matplotlib.pyplot as plt
import torch

num_inputs = 4
num_actions = 2

model = torch.nn.Sequential(
    torch.nn.Linear(num_inputs, 128, bias=False, dtype=torch.float32),
    torch.nn.ReLU(),
    torch.nn.Linear(128, num_actions, bias = False, dtype=torch.float32),
    torch.nn.Softmax(dim=1)
)
```

We will train the network by running many experiments, and updating our network after each run. Let's define a function that will run the experiment and return the results (so-called **trace**) - all states, actions (and their recommended probabilities), and rewards:

```python
def run_episode(max_steps_per_episode = 10000,render=False):    
    states, actions, probs, rewards = [],[],[],[]
    state = env.reset()
    for _ in range(max_steps_per_episode):
        if render:
            env.render()
        action_probs = model(torch.from_numpy(np.expand_dims(state,0)))[0]
        action = np.random.choice(num_actions, p=np.squeeze(action_probs.detach().numpy()))
        nstate, reward, done, info = env.step(action)
        if done:
            break
        states.append(state)
        actions.append(action)
        probs.append(action_probs.detach().numpy())
        rewards.append(reward)
        state = nstate
    return np.vstack(states), np.vstack(actions), np.vstack(probs), np.vstack(rewards)
```

You can run one episode with untrained network and observe that total reward (AKA length of episode) is very low:

```python
s, a, p, r = run_episode()
print(f"Total reward: {np.sum(r)}")
```

One of the tricky aspects of policy gradient algorithm is to use **discounted rewards**. The idea is that we compute the vector of total rewards at each step of the game, and during this process we discount the early rewards using some coefficient $gamma$. We also normalize the resulting vector, because we will use it as weight to affect our training: 

```python
eps = 0.0001

def discounted_rewards(rewards,gamma=0.99,normalize=True):
    ret = []
    s = 0
    for r in rewards[::-1]:
        s = r + gamma * s
        ret.insert(0, s)
    if normalize:
        ret = (ret-np.mean(ret))/(np.std(ret)+eps)
    return ret
```

Now let's do the actual training! We will run 300 episodes, and at each episode we will do the following:

1. Run the experiment and collect the trace
1. Calculate the difference (`gradients`) between the actions taken, and by predicted probabilities. The less the difference is, the more we are sure that we have taken the right action.
1. Calculate discounted rewards and multiply gradients by discounted rewards - that will make sure that steps with higher rewards will make more effect on the final result than lower-rewarded ones
1. Expected target actions for our neural network would be partly taken from the predicted probabilities during the run, and partly from calculated gradients. We will use `alpha` parameter to determine to which extent gradients and rewards are taken into account - this is called *learning rate* of reinforcement algorithm.
1. Finally, we train our network on states and expected actions, and repeat the process 

```python
optimizer = torch.optim.Adam(model.parameters(), lr=0.01)

def train_on_batch(x, y):
    x = torch.from_numpy(x)
    y = torch.from_numpy(y)
    optimizer.zero_grad()
    predictions = model(x)
    loss = -torch.mean(torch.log(predictions) * y)
    loss.backward()
    optimizer.step()
    return loss
```

```python
alpha = 1e-4

history = []
for epoch in range(300):
    states, actions, probs, rewards = run_episode()
    one_hot_actions = np.eye(2)[actions.T][0]
    gradients = one_hot_actions-probs
    dr = discounted_rewards(rewards)
    gradients *= dr
    target = alpha*np.vstack([gradients])+probs
    train_on_batch(states,target)
    history.append(np.sum(rewards))
    if epoch%100==0:
        print(f"{epoch} -> {np.sum(rewards)}")

plt.plot(history)
```

Now let's run the episode with rendering to see the result:

```python
_ = run_episode(render=True)
```

Hopefully, you can see that pole can now balance pretty well!

#### Actor-Critic Model

Actor-Critic model is the further development of policy gradients, in which we build a neural network to learn both the policy and estimated rewards. The network will have two outputs (or you can view it as two separate networks):
* **Actor** will recommend the action to take by giving us the state probability distribution, as in policy gradient model
* **Critic** would estimate what the reward would be from those actions. It returns total estimated rewards in the future at the given state.

Let's define such a model: 

```python
from itertools import count
import torch.nn.functional as F
```

```python
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
env = gym.make("CartPole-v1")

state_size = env.observation_space.shape[0]
action_size = env.action_space.n
lr = 0.0001

class Actor(torch.nn.Module):
    def __init__(self, state_size, action_size):
        super(Actor, self).__init__()
        self.state_size = state_size
        self.action_size = action_size
        self.linear1 = torch.nn.Linear(self.state_size, 128)
        self.linear2 = torch.nn.Linear(128, 256)
        self.linear3 = torch.nn.Linear(256, self.action_size)

    def forward(self, state):
        output = F.relu(self.linear1(state))
        output = F.relu(self.linear2(output))
        output = self.linear3(output)
        distribution = torch.distributions.Categorical(F.softmax(output, dim=-1))
        return distribution

class Critic(torch.nn.Module):
    def __init__(self, state_size, action_size):
        super(Critic, self).__init__()
        self.state_size = state_size
        self.action_size = action_size
        self.linear1 = torch.nn.Linear(self.state_size, 128)
        self.linear2 = torch.nn.Linear(128, 256)
        self.linear3 = torch.nn.Linear(256, 1)

    def forward(self, state):
        output = F.relu(self.linear1(state))
        output = F.relu(self.linear2(output))
        value = self.linear3(output)
        return value
```

We would need to slightly modify our `discounted_rewards` and `run_episode` functions:

```python
def discounted_rewards(next_value, rewards, masks, gamma=0.99):
    R = next_value
    returns = []
    for step in reversed(range(len(rewards))):
        R = rewards[step] + gamma * R * masks[step]
        returns.insert(0, R)
    return returns

def run_episode(actor, critic, n_iters):
    optimizerA = torch.optim.Adam(actor.parameters())
    optimizerC = torch.optim.Adam(critic.parameters())
    for iter in range(n_iters):
        state = env.reset()
        log_probs = []
        values = []
        rewards = []
        masks = []
        entropy = 0
        env.reset()

        for i in count():
            env.render()
            state = torch.FloatTensor(state).to(device)
            dist, value = actor(state), critic(state)

            action = dist.sample()
            next_state, reward, done, _ = env.step(action.cpu().numpy())

            log_prob = dist.log_prob(action).unsqueeze(0)
            entropy += dist.entropy().mean()

            log_probs.append(log_prob)
            values.append(value)
            rewards.append(torch.tensor([reward], dtype=torch.float, device=device))
            masks.append(torch.tensor([1-done], dtype=torch.float, device=device))

            state = next_state

            if done:
                print('Iteration: {}, Score: {}'.format(iter, i))
                break

        next_state = torch.FloatTensor(next_state).to(device)
        next_value = critic(next_state)
        returns = discounted_rewards(next_value, rewards, masks)

        log_probs = torch.cat(log_probs)
        returns = torch.cat(returns).detach()
        values = torch.cat(values)

        advantage = returns - values

        actor_loss = -(log_probs * advantage.detach()).mean()
        critic_loss = advantage.pow(2).mean()

        optimizerA.zero_grad()
        optimizerC.zero_grad()
        actor_loss.backward()
        critic_loss.backward()
        optimizerA.step()
        optimizerC.step()

```

Now we will run the main training loop. We will use manual network training process by computing proper loss functions and updating network parameters:

```python

actor = Actor(state_size, action_size).to(device)
critic = Critic(state_size, action_size).to(device)
run_episode(actor, critic, n_iters=100)
```

Finally, let's close the environment.

```python
env.close()
```

#### Takeaway

We have seen two RL algorithms in this demo: simple policy gradient, and more sophisticated actor-critic. You can see that those algorithms operate with abstract notions of state, action and reward - thus they can be applied to very different environments.

Reinforcement learning allows us to learn the best strategy to solve the problem just by looking at the final reward. The fact that we do not need labelled datasets allows us to repeat simulations many times to optimize our models. However, there are still many challenges in RL, which you may learn if you decide to focus more on this interesting area of AI.   

---

**📓 Notebook 代码**（来自 `lessons/6-Other/22-DeepRL/CartPole-RL-TF.ipynb`）:

This notebooks is part of [AI for Beginners Curriculum](http://aka.ms/ai-beginners). It has been inspired by [this blog post](https://medium.com/swlh/policy-gradient-reinforcement-learning-with-keras-57ca6ed32555), [official TensorFlow documentation](https://www.tensorflow.org/tutorials/reinforcement_learning/actor_critic) and [this Keras RL example](https://keras.io/examples/rl/actor_critic_cartpole/).

In this example, we will use RL to train a model to balance a pole on a cart that can move left and right on horizontal scale. We will use [OpenAI Gym](https://www.gymlibrary.ml/) environment to simulate the pole.

> **Note**: You can run this lesson's code locally (eg. from Visual Studio Code), in which case the simulation will open in a new window. When running the code online, you may need to make some tweaks to the code, as described [here](https://towardsdatascience.com/rendering-openai-gym-envs-on-binder-and-google-colab-536f99391cc7).

We will start by making sure Gym is installed:

```python
import sys
!{sys.executable} -m pip install gym pygame
```

Now let's create the CartPole environment and see how to operate on it. An environment has the following properties:

* **Action space** is the set of possible actions that we can perform at each step of the simulation
* **Observation space** is the space of observations that we can make

```python
import gym
import pygame
import tqdm

env = gym.make("CartPole-v1")

print(f"Action space: {env.action_space}")
print(f"Observation space: {env.observation_space}")
```

Let's see how the simulation works. The following loop runs the simulation, until `env.step` does not return the termination flag `done`. We will randomly chose actions using `env.action_space.sample()`, which means the experiment will probably fail very fast (CartPole environment terminates when the speed of CartPole, its position or angle are outside certain limits).

> Simulation will open in the new window. You can run the code several times and see how it behaves.

```python
env.reset()

done = False
total_reward = 0
while not done:
   env.render()
   obs, rew, done, info = env.step(env.action_space.sample())
   total_reward += rew
   print(f"{obs} -> {rew}")
print(f"Total reward: {total_reward}")

env.close()
```

Youn can notice that observations contain 4 numbers. They are:
- Position of cart
- Velocity of cart
- Angle of pole
- Rotation rate of pole

`rew` is the reward we receive at each step. You can see that in CartPole environment you are rewarded 1 point for each simulation step, and the goal is to maximize total reward, i.e. the time CartPole is able to balance without falling.

During reinforcement learning, our goal is to train a **policy** $\pi$, that for each state $s$ will tell us which action $a$ to take, so essentially $a = \pi(s)$.

If you want probabilistic solution, you can think of policy as returning a set of probabilities for each action, i.e. $\pi(a|s)$ would mean a probability that we should take action $a$ at state $s$.

#### Policy Gradient Method

In simplest RL algorithm, called **Policy Gradient**, we will train a neural network to predict the next action.

```python
import numpy as np
import tensorflow as tf
from tensorflow import keras
import matplotlib.pyplot as plt

num_inputs = 4
num_actions = 2

model = keras.Sequential([
    keras.layers.Dense(128, activation="relu",input_shape=(num_inputs,)),
    keras.layers.Dense(num_actions, activation="softmax")
])

model.compile(loss='categorical_crossentropy', optimizer=keras.optimizers.Adam(learning_rate=0.01))
```

We will train the network by running many experiments, and updating our network after each run. Let's define a function that will run the experiment and return the results (so-called **trace**) - all states, actions (and their recommended probabilities), and rewards:

```python
def run_episode(max_steps_per_episode = 10000,render=False):    
    states, actions, probs, rewards = [],[],[],[]
    state = env.reset()
    for _ in range(max_steps_per_episode):
        if render:
            env.render()
        action_probs = model(np.expand_dims(state,0))[0]
        action = np.random.choice(num_actions, p=np.squeeze(action_probs))
        nstate, reward, done, info = env.step(action)
        if done:
            break
        states.append(state)
        actions.append(action)
        probs.append(action_probs)
        rewards.append(reward)
        state = nstate
    return np.vstack(states), np.vstack(actions), np.vstack(probs), np.vstack(rewards)
```

You can run one episode with untrained network and observe that total reward (AKA length of episode) is very low:

```python
s,a,p,r = run_episode()
print(f"Total reward: {np.sum(r)}")
```

One of the tricky aspects of policy gradient algorithm is to use **discounted rewards**. The idea is that we compute the vector of total rewards at each step of the game, and during this process we discount the early rewards using some coefficient $gamma$. We also normalize the resulting vector, because we will use it as weight to affect our training: 

```python
eps = 0.0001

def discounted_rewards(rewards,gamma=0.99,normalize=True):
    ret = []
    s = 0
    for r in rewards[::-1]:
        s = r + gamma * s
        ret.insert(0, s)
    if normalize:
        ret = (ret-np.mean(ret))/(np.std(ret)+eps)
    return ret
```

Now let's do the actual training! We will run 300 episodes, and at each episode we will do the following:

1. Run the experiment and collect the trace
1. Calculate the difference (`gradients`) between the actions taken, and by predicted probabilities. The less the difference is, the more we are sure that we have taken the right action.
1. Calculate discounted rewards and multiply gradients by discounted rewards - that will make sure that steps with higher rewards will make more effect on the final result than lower-rewarded ones
1. Expected target actions for our neural network would be partly taken from the predicted probabilities during the run, and partly from calculated gradients. We will use `alpha` parameter to determine to which extent gradients and rewards are taken into account - this is called *learning rate* of reinforcement algorithm.
1. Finally, we train our network on states and expected actions, and repeat the process 

```python
alpha = 1e-4

history = []
for epoch in range(300):
    states, actions, probs, rewards = run_episode()
    one_hot_actions = np.eye(2)[actions.T][0]
    gradients = one_hot_actions-probs
    dr = discounted_rewards(rewards)
    gradients *= dr
    target = alpha*np.vstack([gradients])+probs
    model.train_on_batch(states,target)
    history.append(np.sum(rewards))
    if epoch%100==0:
        print(f"{epoch} -> {np.sum(rewards)}")

plt.plot(history)
```

Now let's run the episode with rendering to see the result:

```python
_ = run_episode(render=True)
```

Hopefully, you can see that pole can now balance pretty well!

#### Actor-Critic Model

Actor-Critic model is the further development of policy gradients, in which we build a neural network to learn both the policy and estimated rewards. The network will have two outputs (or you can view it as two separate networks):
* **Actor** will recommend the action to take by giving us the state probability distribution, as in policy gradient model
* **Critic** would estimate what the reward would be from those actions. It returns total estimated rewards in the future at the given state.

Let's define such a model: 

```python
num_inputs = 4
num_actions = 2
num_hidden = 128

inputs = keras.layers.Input(shape=(num_inputs,))
common = keras.layers.Dense(num_hidden, activation="relu")(inputs)
action = keras.layers.Dense(num_actions, activation="softmax")(common)
critic = keras.layers.Dense(1)(common)

model = keras.Model(inputs=inputs, outputs=[action, critic])
```

We would need to slightly modify our `run_episode` function to return also critic results:

```python
def run_episode(max_steps_per_episode = 10000,render=False):    
    states, actions, probs, rewards, critic = [],[],[],[],[]
    state = env.reset()
    for _ in range(max_steps_per_episode):
        if render:
            env.render()
        action_probs, est_rew = model(np.expand_dims(state,0))
        action = np.random.choice(num_actions, p=np.squeeze(action_probs[0]))
        nstate, reward, done, info = env.step(action)
        if done:
            break
        states.append(state)
        actions.append(action)
        probs.append(tf.math.log(action_probs[0,action]))
        rewards.append(reward)
        critic.append(est_rew[0,0])
        state = nstate
    return states, actions, probs, rewards, critic
```

Now we will run the main training loop. We will use manual network training process by computing proper loss functions and updating network parameters:

```python
optimizer = keras.optimizers.Adam(learning_rate=0.01)
huber_loss = keras.losses.Huber()
episode_count = 0
running_reward = 0

while True:  # Run until solved
    state = env.reset()
    episode_reward = 0
    with tf.GradientTape() as tape:
        _,_,action_probs, rewards, critic_values = run_episode()
        episode_reward = np.sum(rewards)
        
        # Update running reward to check condition for solving
        running_reward = 0.05 * episode_reward + (1 - 0.05) * running_reward

        # Calculate discounted rewards that will be labels for our critic
        dr = discounted_rewards(rewards)

        # Calculating loss values to update our network
        actor_losses = []
        critic_losses = []
        for log_prob, value, rew in zip(action_probs, critic_values, dr):
            # When we took the action with probability `log_prob`, we received discounted reward of `rew`,
            # while critic predicted it to be `value` 
            # First we calculate actor loss, to make actor predict actions that lead to higher rewards
            diff = rew - value
            actor_losses.append(-log_prob * diff)

            # The critic loss is to minimize the difference between predicted reward `value` and actual
            # discounted reward `rew`
            critic_losses.append(
                huber_loss(tf.expand_dims(value, 0), tf.expand_dims(rew, 0))
            )

        # Backpropagation
        loss_value = sum(actor_losses) + sum(critic_losses)
        grads = tape.gradient(loss_value, model.trainable_variables)
        optimizer.apply_gradients(zip(grads, model.trainable_variables))

    # Log details
    episode_count += 1
    if episode_count % 10 == 0:
        template = "running reward: {:.2f} at episode {}"
        print(template.format(running_reward, episode_count))

    if running_reward > 195:  # Condition to consider the task solved
        print("Solved at episode {}!".format(episode_count))
        break

```

Let's run the episode and see how good our model is:

```python
_ = run_episode(render=True)
```

Finally, let's close the environment.

```python
env.close()
```

#### Takeaway

We have seen two RL algorithms in this demo: simple policy gradient, and more sophisticated actor-critic. You can see that those algorithms operate with abstract notions of state, action and reward - thus they can be applied to very different environments.

Reinforcement learning allows us to learn the best strategy to solve the problem just by looking at the final reward. The fact that we do not need labelled datasets allows us to repeat simulations many times to optimize our models. However, there are still many challenges in RL, which you may learn if you decide to focus more on this interesting area of AI.   

---

**🔧 练习**（来自 `lessons/6-Other/22-DeepRL/lab/README.md`）:

Lab Assignment from [AI for Beginners Curriculum](https://github.com/microsoft/ai-for-beginners).

#### Task

Your goal is to train the RL agent to control [Mountain Car](https://www.gymlibrary.ml/environments/classic_control/mountain_car/) in OpenAI Environment.

<img alt="Mountain Car" src="images/mountaincar.png" width="300"/>

#### The Environment

Mountain Car environment consists of the car trapped inside a valley. Your goal is to jump out of the valley and reach the flag. The actions you can perform are to accelerate to the left, to the right, or do nothing. You can observe position of the car along x-axis, and velocity.

#### Stating Notebook

Start the lab by opening [MountainCar.ipynb](MountainCar.ipynb)

#### Takeaway

You should learn throughout this lab that adopting RL algorithms to a new environment is often quite straightforward, because the OpenAI Gym has the same interface for all environments, and algorithms as such do not largely depend on the nature of the environment. You can even restructure the Python code in such a way as to pass any environment to RL algorithm as a parameter.

### Deep Reinforcement Learning

Reinforcement learning (RL) is seen as one of the basic machine learning paradigms, next to supervised learning and unsupervised learning. While in supervised learning we rely on the dataset with known outcomes, RL is based on **learning by doing**. For example, when we first see a computer game, we start playing, even without knowing the rules, and soon we are able to improve our skills just by the process of playing and adjusting our behavior.

To perform RL, we need:

* An **environment** or **simulator** that sets the rules of the game. We should be able to run the experiments in the simulator and observe the results.
* Some **Reward function**, which indicate how successful our experiment was. In case of learning to play a computer game, the reward would be our final score.

Based on the reward function, we should be able to adjust our behavior and improve our skills, so that the next time we play better. The main difference between other types of machine learning and RL is that in RL we typically do not know whether we win or lose until we finish the game. Thus, we cannot say whether a certain move alone is good or not - we only receive a reward at the end of the game.

During RL, we typically perform many experiments. During each experiment, we need to balance between following the optimal strategy that we have learned so far (**exploitation**) and exploring new possible states (**exploration**).

#### OpenAI Gym

A great tool for RL is the [OpenAI Gym](https://gym.openai.com/) - a **simulation environment**, which can simulate many different environments starting from Atari games, to the physics behind pole balancing. It is one of the most popular simulation environments for training reinforcement learning algorithms, and is maintained by [OpenAI](https://openai.com/).

> **Note**: You can see all the environments available from OpenAI Gym [here](https://gym.openai.com/envs/#classic_control).

#### CartPole Balancing

You have probably all seen modern balancing devices such as the *Segway* or *Gyroscooters*. They are able to automatically balance by adjusting their wheels in response to a signal from an accelerometer or gyroscope. In this section, we will learn how to solve a similar problem - balancing a pole. It is similar to a situation when a circus performer needs to balance a pole on his hand - but this pole balancing only occurs in 1D.

A simplified version of balancing is known as a **CartPole** problem. In the cartpole world, we have a horizontal slider that can move left or right, and the goal is to balance a vertical pole on top of the slider as it moves.

<img alt="a cartpole" src="images/cartpole.png" width="200"/>

To create and use this environment, we need a couple of lines of Python code:

```python
import gym
env = gym.make("CartPole-v1")

env.reset()
done = False
total_reward = 0
while not done:
   env.render()
   action = env.action_space.sample()
   observaton, reward, done, info = env.step(action)
   total_reward += reward

print(f"Total reward: {total_reward}")
```

Each environment can be accessed exactly in the same way:
* `env.reset` starts a new experiment
* `env.step` performs a simulation step. It receives an **action** from the **action space**, and returns an **observation** (from the observation space), as well as a reward and a termination flag.

In the example above we perform a random action at each step, which is why the experiment life is very short:

![non-balancing cartpole](images/cartpole-nobalance.gif)

The goal of a RL algorithm is to train a model - the so called **policy** &pi; - which will return the action in response to a given state. We can also consider policy to be probabilistic, eg. for any state *s* and action *a* it will return the probability &pi;(*a*|*s*) that we should take *a* in state *s*.

#### Policy Gradients Algorithm

The most obvious way to model a policy is by creating a neural network that will take states as input, and return corresponding actions (or rather the probabilities of all actions). In a sense, it would be similar to a normal classification task, with a major difference - we do not know in advance which actions should we take at each of the steps.

The idea here is to estimate those probabilities. We build a vector of **cumulative rewards** which shows our total reward at each step of the experiment. We also apply **reward discounting** by multiplying earlier rewards by some coefficient &gamma;=0.99, in order to diminish the role of earlier rewards. Then, we reinforce those steps along the experiment path that yield larger rewards.

> Learn more about the Policy Gradient algorithm and see it in action in the [example notebook](CartPole-RL-TF.ipynb).

#### Actor-Critic Algorithm

An improved version of the Policy Gradients approach is called **Actor-Critic**. The main idea behind it is that the neural network would be trained to return two things:

* The policy, which determines which action to take. This part is called **actor**
* The estimation of the total reward we can expect to get at this state - this part is called **critic**.

In a sense, this architecture resembles a [GAN](../../4-ComputerVision/10-GANs/README.md), where we have two networks that are trained against each other. In the actor-critic model, the actor proposes the action we need to take, and the critic tries to be critical and estimate the result. However, our goal is to train those networks in unison.

Because we know both the real cumulative rewards and the results returned by the critic during the experiment, it is relatively easy to build a loss function that will minimize the difference between them. That would give us **critic loss**. We can compute **actor loss** by using the same approach as in the policy gradient algorithm.

After running one of those algorithms, we can expect our CartPole to behave like this:

![a balancing cartpole](images/cartpole-balance.gif)

#### ✍️ Exercises: Policy Gradients and Actor-Critic RL

Continue your learning in the following notebooks:

* [RL in TensorFlow](CartPole-RL-TF.ipynb)
* [RL in PyTorch](CartPole-RL-PyTorch.ipynb)

#### Other RL Tasks

Reinforcement Learning nowadays is a fast growing field of research. Some of the interesting examples of reinforcement learning are:

* Teaching a computer to play **Atari Games**. The challenging part in this problem is that we do not have simple state represented as a vector, but rather a screenshot - and we need to use the CNN to convert this screen image to a feature vector, or to extract reward information. Atari games are available in the Gym.
* Teaching a computer to play board games, such as Chess and Go. Recently state-of-the-art programs like **Alpha Zero** were trained from scratch by two agents playing against each other, and improving at each step.
* In industry, RL is used to create control systems from simulation. A service called [Bonsai](https://azure.microsoft.com/services/project-bonsai/?WT.mc_id=academic-77998-cacaste) is specifically designed for that.

#### Conclusion

We have now learned how to train agents to achieve good results just by providing them a reward function that defines the desired state of the game, and by giving them an opportunity to intelligently explore the search space. We have successfully tried two algorithms, and achieved a good result in a relatively short period of time. However, this is just the beginning of your journey into RL, and you should definitely consider taking a separate course is you want to dig deeper.

#### 🚀 Challenge

Explore the applications listed in the 'Other RL Tasks' section and try to implement one!

#### Review & Self Study

Learn more about classical reinforcement learning in our [Machine Learning for Beginners Curriculum](https://github.com/microsoft/ML-For-Beginners/blob/main/8-Reinforcement/README.md).

Watch [this great video](https://www.youtube.com/watch?v=qv6UVOQ0F44) talking about how a computer can learn to play Super Mario.

#### Assignment: [Train a Mountain Car](lab/README.md)

Your goal during this assignment would be to train a different Gym environment - [Mountain Car](https://www.gymlibrary.ml/environments/classic_control/mountain_car/).

### Models Library

A great thing about NetLogo is that it contains a library of working models that you can try. Go to **File &rightarrow; Models Library**, and you have many categories of models to choose from.

<img alt="NetLogo Models Library" src="images/NetLogo-ModelLib.png" width="60%"/>

> A screenshot of the models library by Dmitry Soshnikov

You can open one of the models, for example **Biology &rightarrow; Flocking**.

### Main Principles

After opening the model, you are taken to the main NetLogo screen. Here is a sample model that describes the population of wolves and sheep, given finite resources (grass).

![NetLogo Main Screen](images/NetLogo-Main.png)

> Screenshot by Dmitry Soshnikov

On this screen, you can see:

* The **Interface** section which contains:
  - The main field, where all agents live
  - Different controls: buttons, sliders, etc.
  - Graphs that you can use to display parameters of the simulation
* The **Code** tab which contains the editor, where you can type NetLogo program

In most cases, the interface would have a **Setup** button, which initializes the simulation state, and a **Go** button that starts the execution. Those are handled by corresponding handlers in the code that look like this:

```
to go [
...
]
```

NetLogo's world consists of the following objects:

* **Agents** (turtles) that can move across the field and do something. You command agents by using `ask turtles [...]` syntax, and the code in brackets is executed by all agents in *turtle mode*.
* **Patches** are square areas of the field, on which agents live. You can refer to all agents on the same patch, or you can change patch colors and some other properties. You can also `ask patches` to do something.
* **Observer** is a unique agent that controls the world. All button handlers are executed in *observer mode*.

> ✅ The beauty of a multi-agent environment is that the code that runs in turtle mode or in patch mode is executed at the same time by all agents in parallel. Thus, by writing a little code and programming the behavior of individual agent, you can create complex behavior of the simulation system as a whole.

### Flocking

As an example of multi-agent behavior, let's consider **[Flocking](https://en.wikipedia.org/wiki/Flocking_(behavior))**. Flocking is a complex pattern that is very similar to how flocks of birds fly. Watching them fly you can think that they follow some kind of collective algorithm, or that they possess some form of *collective intelligence*. However, this complex behavior arises when each individual agent (in this case, a *bird*) only observes some other agents in a short distance from it, and follows three simple rules:

* **Alignment** - it steers towards the average heading of neighboring agents
* **Cohesion** - it tries to steer towards the average position of neighbors (*long range attraction*)
* **Separation** - when getting too close to other birds, it tries to move away (*short range repulsion*)

You can run the flocking example and observe the behavior. You can also adjust parameters, such as *degree of separation*, or the *viewing range*, which defines how far each bird can see. Note that if you decrease the viewing range to 0, all birds become blind, and flocking stops. If you decrease separation to 0, all birds gather into a straight line.

> ✅ Switch to the **Code** tab and see where three rules of flocking (alignment, cohesion and separation) are implemented in code. Note how we refer only to those agents that are in sight.

### Other Models to see

There are a few more interesting models that you can experiment with:

* **Art &rightarrow; Fireworks** shows how a firework can be considered a collective behavior of individual fire streams
* **Social Science &rightarrow; Traffic Basic** and **Social Science &rightarrow; Traffic Grid** show the model of city traffic in 1D and 2D Grid with or without traffic lights. Each car in the simulation follows the following rules:
   - If the space in front of it is empty - accelerate (up to a certain max speed)
   - If it sees the obstacle in front - brake (and you can adjust how far a driver can see)
* **Social Science &rightarrow; Party** shows how people group together during a cocktail party. You can find the combination of parameters that lead to the fastest increase of happiness of the group.

As you can see from these examples, multi-agent simulations can be quite a useful way to understand the behavior of a complex system consisting of individuals that follow the same or similar logic. It can also be used to control virtual agents, such as [NPCs](https://en.wikipedia.org/wiki/NPC) in computer games, or agents in 3D animated worlds.

## Ethics

### Ethical and Responsible AI

You have almost finished this course, and I hope that by now you clearly see that AI is based on a number of formal mathematical methods that allow us to find relationships in data and train models to replicate some aspects of human behavior. At this point in history, we consider AI to be a very powerful tool to extract patterns from data, and to apply those patterns to solve new problems.

However, in science fiction we often see stories where AI presents a danger to humankind. Usually those stories are centered around some sort of AI rebellion, when AI decides to confront human beings. This implies that AI has some sort of emotion or can take decisions unforeseen by its developers.

The kind of AI that we have learned about in this course is nothing more than large matrix arithmetic. It is a very powerful tool to help us solve our problems, and as any other powerful tool - it can be used for good and for bad purposes. Importantly, it can be *misused*.

#### Principles of Responsible AI

To avoid this accidental or purposeful misuse of AI, Microsoft states the important [Principles of Responsible AI](https://www.microsoft.com/ai/responsible-ai?WT.mc_id=academic-77998-cacaste). The following concepts underpin these principles:

* **Fairness** is related to the important problem of *model biases*, which can be caused by using biased data for training. For example, when we try to predict the probability of getting a software developer job for a person, the model is likely to give higher preference to males - just because the training dataset was likely biased towards a male audience. We need to carefully balance training data and investigate the model to avoid biases, and make sure that the model takes into account more relevant features.
* **Reliability and Safety**. By their nature, AI models can make mistakes. A neural network returns probabilities, and we need to take it into account when making decisions. Every model has some precision and recall, and we need to understand that to prevent harm that wrong advice can cause.
* **Privacy and Security** have some AI-specific implications. For example, when we use some data for training a model, this data becomes somehow "integrated" into the model. On one hand, that increases security and privacy, on the other - we need to remember which data the model was trained on.
* **Inclusiveness** means that we are not building AI to replace people, but rather to augment people and make our work more creative. It is also related to fairness, because when dealing with underrepresented communities, most of the datasets we collect are likely to be biased, and we need to make sure that those communities are included and correctly handled by AI.
* **Transparency**. This includes making sure that we are always clear about AI being used. Also, wherever possible, we want to use AI systems that are *interpretable*.
* **Accountability**. When AI models come up with some decisions, it is not always clear who is responsible for those decisions. We need to make sure that we understand where responsibility of AI decisions lies. In most cases we would want to include human beings into the loop of making important decisions, so that actual people are made accountable.

#### Tools for Responsible AI

Microsoft has developed the [Responsible AI Toolbox](https://github.com/microsoft/responsible-ai-toolbox) which contains a set of tools:

* Interpretability Dashboard (InterpretML)
* Fairness Dashboard (FairLearn)
* Error Analysis Dashboard
* Responsible AI Dashboard that includes

   - EconML - tool for Causal Analysis, which focuses on what-if questions
   - DiCE - tool for Counterfactual Analysis allows you to see which features need to be changed to affect the decision of the model

For more information about AI Ethics, please visit [this lesson](https://github.com/microsoft/ML-For-Beginners/tree/main/1-Introduction/3-fairness?WT.mc_id=academic-77998-cacaste) on the Machine Learning Curriculum which includes assignments.

#### Review & Self Study

Take this [Learn Path](https://docs.microsoft.com/learn/modules/responsible-ai-principles/?WT.mc_id=academic-77998-cacaste) to learn more about responsible AI.

## X Extras

### DALL-E 1

DALL-E is a version of GPT-3 trained to generate images from prompts. It has been trained with 12-billion parameters.

Unlike CLIP, DALL-E receives both text and image as a single stream of tokens for both images and text. Therefore, from multiple prompts, you can generate images based on the text.

### DALL-E 2

The main difference between DALL.E 1 and 2, is that it generates more realistic images and art. 

Examples of image genrations with DALL-E:
![Picture produced by Pixray](images/DALL·E%202023-06-20%2015.56.56%20-%20a%20closeup%20watercolor%20portrait%20of%20young%20male%20teacher%20of%20literature%20with%20a%20book.png) |  ![Picture produced by pixray](images/DALL·E%202023-06-20%2015.57.43%20-%20a%20closeup%20oil%20portrait%20of%20young%20female%20teacher%20of%20computer%20science%20with%20a%20computer.png) | ![Picture produced by Pixray](images/DALL·E%202023-06-20%2015.58.42%20-%20%20a%20closeup%20oil%20portrait%20of%20old%20male%20teacher%20of%20mathematics%20in%20front%20of%20blackboard.png)
----|----|----
Picture generated from prompt *a closeup watercolor portrait of young male teacher of literature with a book* | Picture generated from prompt *a closeup oil portrait of young female teacher of computer science with a computer* | Picture generated from prompt *a closeup oil portrait of old male teacher of mathematics in front of blackboard*
