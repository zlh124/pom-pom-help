/** 纯前端可用的答题结果文案（不依赖 node:fs，供客户端组件引用） */
export function resultLabel(score: number, total: number): { label: string; comment: string } {
  const ratio = total ? score / total : 0;
  if (ratio === 1) {
    return {
      label: "满分通关成就",
      comment: "全对帕！开拓者的知识储备让列车长都刮目相看了——这周的「味觉故障的天才」非你莫属！",
    };
  }
  if (ratio >= 0.8) {
    return {
      label: "七分熟的开拓者",
      comment: "差一点点就满分了帕！错的那些题，帕姆猜开拓者当时一定在偷偷看窗外。",
    };
  }
  if (ratio >= 0.6) {
    return {
      label: "博士尊的凝视",
      comment: "不错不错，大部分都答对了帕。剩下的交给帕姆，下次一起补课！",
    };
  }
  if (ratio >= 0.3) {
    return {
      label: "六十分万岁",
      comment: "唔……成绩嘛，重在参与帕！列车长会把这些知识点记在小本本上的。",
    };
  }
  if (ratio > 0) {
    return {
      label: "丹恒同款记忆力",
      comment: "开拓者是不是把这周的题当成列车时刻表看了帕？没关系，下次再来！",
    };
  }
  return {
    label: "十题全缘·疑似橡木人",
    comment: "全错也是一种天赋帕……帕姆沉默了三十秒，然后决定下次出题前先给开拓者补课。",
  };
}
