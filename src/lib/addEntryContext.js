import { createContext, useContext } from 'react';

// The single "+ Add to Dossier" flow (components/AddEntry.jsx) is
// owned and mounted exactly ONCE, by AppShell.jsx (see its sidebar
// button and floating action button). Before this, DestinationDetail
// mounted its OWN separate <AddEntry> instance for its in-page "+ Add"
// button, which meant two different, independently-stated Add
// experiences could be visible on the same screen at once. This
// context lets any page's own "+ Add" button (e.g. the Research tab's
// button in DestinationDetail.jsx) open that one shared instance
// instead of mounting a second one — there is still exactly one
// button per screen location, and exactly one modal in the whole app.
const AddEntryContext = createContext(() => {});

export const AddEntryProvider = AddEntryContext.Provider;

// Returns a function that opens the one shared Add modal. Call it
// from any page's own "+ Add" button.
export function useOpenAddEntry() {
  return useContext(AddEntryContext);
}
