export async function waitForElementText(page, selector, expectedText, timeout = 5_000) {
  await page.waitForFunction(
    ({ selector: elementSelector, expected }) => {
      const element = document.querySelector(elementSelector);
      return element?.textContent?.trim() === expected;
    },
    { selector, expected: expectedText },
    { timeout },
  );
}
