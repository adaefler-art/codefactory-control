export class Octokit {
  public rest: any;

  constructor(_options?: any) {
    this.rest = {
      issues: {
        createComment: async () => ({ data: {} }),
        listForRepo: async () => ({ data: [] }),
      },
      pulls: {
        list: async () => ({ data: [] }),
      },
      repos: {
        getContent: async () => ({ data: {} }),
      },
    };
  }
}
