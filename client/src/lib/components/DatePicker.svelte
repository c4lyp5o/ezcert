<script lang="ts">
  import {
    DateFormatter,
    type DateValue,
    getLocalTimeZone,
  } from "@internationalized/date";
  import { Calendar } from "bits-ui";
  import { Popover } from "bits-ui";
  import { Calendar as CalendarIcon } from "lucide-svelte";

  let { value = $bindable() } = $props();

  const df = new DateFormatter("en-US", { dateStyle: "medium" });
  let placeholder = $state<DateValue>();

  function formatDate(date: DateValue | undefined) {
    if (!date) return "Pick a date";
    return df.format(date.toDate(getLocalTimeZone()));
  }
</script>

<Popover.Root>
  <Popover.Trigger
    class="flex h-10 w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
  >
    {formatDate(value)}
    <CalendarIcon class="ml-2 h-4 w-4 opacity-50" />
  </Popover.Trigger>

  <Popover.Content
    class="w-auto p-0 z-50 bg-white border rounded-lg shadow-lg"
    sideOffset={8}
  >
    <Calendar.Root bind:value bind:placeholder class="p-3 border rounded-md">
      <Calendar.Header class="flex items-center justify-between pt-1 pb-4">
        <Calendar.PrevButton class="p-2 hover:bg-zinc-100 rounded-md">
          ←
        </Calendar.PrevButton>
        <Calendar.Heading class="text-sm font-medium" />
        <Calendar.NextButton class="p-2 hover:bg-zinc-100 rounded-md">
          →
        </Calendar.NextButton>
      </Calendar.Header>

      <Calendar.Grid class="w-full border-collapse space-y-1">
        <Calendar.GridHead>
          <Calendar.GridRow class="flex w-full justify-between">
            {#each ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as day}
              <Calendar.HeadCell
                class="w-9 text-[0.8rem] font-normal text-zinc-500"
              >
                {day}
              </Calendar.HeadCell>
            {/each}
          </Calendar.GridRow>
        </Calendar.GridHead>

        <Calendar.GridBody>
          {#each [0, 1, 2, 3, 4, 5] as week}
            <Calendar.GridRow class="flex w-full mt-2">
              {#each [0, 1, 2, 3, 4, 5, 6] as _}{/each}
            </Calendar.GridRow>
          {/each}
        </Calendar.GridBody>
      </Calendar.Grid>

      <div class="flex flex-col gap-y-1 mt-2">
        {#each [0, 1, 2, 3, 4, 5] as weekIndex (weekIndex)}
          <Calendar.GridRow class="flex w-full">
            {#each [0, 1, 2, 3, 4, 5, 6] as dayIndex (dayIndex)}
              <Calendar.Cell
                class="relative p-0 text-center text-sm focus-within:relative focus-within:z-20 data-[selected]:bg-zinc-900 data-[selected]:text-zinc-50 hover:bg-zinc-100 rounded-md h-9 w-9 flex items-center justify-center"
                date={placeholder}
                month={placeholder}
              >
                <Calendar.Day
                  class="h-9 w-9 p-0 font-normal aria-selected:opacity-100"
                />
              </Calendar.Cell>
            {/each}
          </Calendar.GridRow>
        {/each}
      </div>
    </Calendar.Root>
  </Popover.Content>
</Popover.Root>
