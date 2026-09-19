---
profile: default
---

[网络空间安全2401班](ref:hrseg0018 | padding=cover)
[U202412345](ref:hrseg0022 | padding=cover)
[李四](ref:hrseg0026 | padding=cover)
[王老师](ref:hrseg0028 | padding=cover)
[2026年9月20日](ref:hrseg0030 | padding=cover)

# 实验6 指针程序设计实验 {ref:hrseg0067}

## 1.1 程序改错与跟踪调试 {ref:hrseg0070}

在本次改错练习中，针对指针未初始化及越界访问进行了系统排查与跟踪。

1. **错误定位**：原程序中 `char *p; strcpy(p, "hello");` 存在野指针解引用错误。
2. **原因分析**：局部指针变量未分配堆或栈内存空间直接作为字符串复制的目的地址，导致段错误（Segmentation Fault）。
3. **改进方案**：修改为 `char p[64]; strcpy(p, "hello");` 或动态分配 `p = malloc(64);`。

## 1.2 程序完善与修改替换 {ref:hrseg0074}

完善动态链表的插入与倒序函数，使用双指针避免单链表逆序过程中的断链现象：

```c
typedef struct Node {
    int val;
    struct Node *next;
} Node;

Node* reverseList(Node* head) {
    Node *prev = NULL, *curr = head;
    while (curr) {
        Node *next = curr->next;
        curr->next = prev;
        prev = curr;
        curr = next;
    }
    return prev;
}
```

## 1.3 程序设计 {ref:hrseg0080}

设计了一个学生成绩管理模块的快速排序算法，利用函数指针实现多种排序维度的泛型比较。

- **算法步骤**：选取基准元素 pivot，采用双向扫描法划分数组；递归处理左右子数组。
- **复杂度分析**：平均时间复杂度为 $O(N \log N)$，空间复杂度为 $O(\log N)$。

```c
int compareScore(const void *a, const void *b) {
    return (*(const float*)b - *(const float*)a > 0) ? 1 : -1;
}
```

## 1.4 小结 {ref:hrseg0099}

深入理解了 C 语言指针与数组在内存底层的等价性与差异性。指针传递作为函数参数大幅提高了大型数据结构的传参效率，但必须时刻警惕越界与生命周期失效问题。

# 2 实验7 结构与联合 {ref:hrseg0102}

## 2.1 表达式求值的程序验证 {ref:hrseg0103}

通过构造内存探针联合体，验证了大小端架构下结构体成员的对齐与填充规则。32位系统下因 4 字节自然对齐原则，`char` 字段后补齐 3 字节填充位。

## 2.2 源程序修改替换 {ref:hrseg0109}

将链表节点改造为带头结点的双向循环链表，统一了头尾节点的插入与删除逻辑，避免了大量的边界 NULL 判断分支。

## 2.3 程序设计 {ref:hrseg0114}

实现了一个基于变长结构体的二进制序列化缓存管理模块，支持将异构数据打包并通过统一通信接口传输。

## 2.4小结 {ref:hrseg0119}

熟练掌握了联合体（union）在协议解析中的共享内存技巧，以及位域（bit-field）在底层硬件寄存器模拟映射中的核心作用。

# 参考文献 {ref:hrseg0122}

```text
[1] 卢萍, 李开, 王多强, 甘早斌. C语言程序设计典型题解与实验指导. 北京: 清华大学出版社, 2019.
[2] Brian W. Kernighan, Dennis M. Ritchie. The C Programming Language (2nd Edition). Prentice Hall, 1988.
```
