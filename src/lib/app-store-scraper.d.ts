declare module "app-store-scraper" {
  namespace store {
    const sort: {
      RECENT: number;
      HELPFUL: number;
    };
    function reviews(opts: {
      id: string | number;
      country?: string;
      page?: number;
      sort?: string;
    }): Promise<
      Array<{
        id: string;
        userName: string;
        userUrl: string;
        version: string;
        score: number;
        title: string;
        text: string;
        updated: string;
        url: string;
      }>
    >;
    function app(opts: {
      id: string;
      country?: string;
    }): Promise<{
      id: number;
      appId: string;
      title: string;
      // ...other fields
    }>;
  }
  export = store;
}
