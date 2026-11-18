'use client';

import { createContext, useContext } from 'react';

/**
 * The dashboard top bar holds the current page's title. The shell provides the bar's title
 * element here and PageHeader renders its title into it through a portal.
 * `available` is true inside the shell even before the element is mounted, so the title is
 * never painted in the page first and then moved.
 */
export const PageTitleSlotContext = createContext<{ available: boolean; element: HTMLElement | null }>({
  available: false,
  element: null,
});

export function usePageTitleSlot() {
  return useContext(PageTitleSlotContext);
}
