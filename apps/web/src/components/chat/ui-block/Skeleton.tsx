import { uiBlockViewStrings } from './ui-block.strings.ts';

/**
 * Where a drawn block will be: three bars on the bubble's own colour (styles.css `.ui-skeleton`,
 * in the first bundle so it can stand in while the block's chunk loads). A status for screen
 * readers; the bars blink by frames, still with less motion.
 */
export function BlockSkeleton() {
  return (
    <div
      className="ui-skeleton"
      role="status"
      aria-label={uiBlockViewStrings().drawing}
      data-testid="ui-block-skeleton"
    >
      <i />
      <i />
      <i />
    </div>
  );
}
