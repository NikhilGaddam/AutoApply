
    const puppeteer = require('puppeteer');
    (async () => {
      try {
        const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
        const pages = await browser.pages();
        const page = pages.find(p => p.url().includes('proofpoint.wd5.myworkdayjobs.com'));
        if (!page) { console.log('Page not found'); process.exit(1); }
        
        const nextButton = await page.$('button[data-automation-id="bottomNextButton"]');
        if (nextButton) {
          await nextButton.click();
          console.log('Clicked Next');
          await new Promise(r => setTimeout(r, 5000));
        } else {
          console.log('Next button not found');
        }
        process.exit(0);
      } catch (e) {
        console.error(e);
        process.exit(1);
      }
    })();
    