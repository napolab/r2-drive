---
paths:
  - "apps/*/src/**/*.tsx"
  - "packages/*/src/**/*.tsx"
---

# React Conventions

## No RSC — Data Comes From Loaders

This project uses **TanStack Start without React Server Components**. `'use client'` does not exist here and must never be written. react-aria-components are client-side state machines, so an RSC split would produce boundaries everywhere without buying anything.

Data flows one way:

- Route `loader` calls `queryClient.ensureQueryData(...)` — this is where SSR prefetch happens
- Components read the same `queryKey` with TanStack Query and hydrate on the client
- Components never fetch in `useEffect`

### Suspense Boundary Rules

Wrap every suspending subtree with `ErrorBoundary` > `Suspense` (ErrorBoundary on the outside to catch both render and Suspense errors), and keep the boundary as small as the thing that actually suspends.

```tsx
// Correct — the boundary wraps only what suspends
const Page = () => (
  <>
    <BucketHeader />
    <ErrorBoundary fallback={<ObjectListError />}>
      <Suspense fallback={<ObjectListSkeleton />}>
        <ObjectList />  {/* suspends on the objects query */}
      </Suspense>
    </ErrorBoundary>
  </>
);

// Wrong - entire page is inside one boundary
const Page = () => (
  <div>
    <HeroSection />
    <StaticContent />
    <InteractiveWidget />
  </div>
);
```

| Principle               | Rule                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| Default                 | Plain component. `'use client'` does not exist in this project           |
| Suspending subtree      | Always wrap with `ErrorBoundary` > `Suspense`, as small as possible      |
| Data fetching           | Route `loader` → `ensureQueryData`; components read the same `queryKey`  |
| Server-only work        | Hono route in `packages/api`, reached through the typed `hc` client      |

## useEffect Restrictions (ULTRA STRICT)

### NEVER Use useEffect For:

- Data fetching
- State synchronization
- Derived state calculations
- Subscribing to external stores (use `useSyncExternalStore`)

### Absolutely Forbidden Pattern

```typescript
// FORBIDDEN: useEffect + useState for data fetching
const Component = ({ userId }: { userId: string }) => {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchUser(userId).then(setUser); // NEVER DO THIS
  }, [userId]);
};
```

### When useEffect IS Acceptable

Only for imperative DOM operations, with mandatory justification comment:

```typescript
useEffect(() => {
  // USEEFFECT_JUSTIFICATION: Required for imperative DOM focus
  // Cannot use Suspense as this is direct DOM manipulation
  inputRef.current?.focus();
}, []);
```

## Event Handler Rules (jsx-no-bind)

### Forbidden Pattern

```typescript
// Creates new function on every render
<button onClick={() => handleClick()}>Click</button>
<button onClick={() => onItemClick(item.id)}>Click</button>
```

### Correct Patterns

```typescript
// Use useCallback
const handleClick = useCallback(() => {
  // Handle click
}, []);

<button onClick={handleClick}>Click</button>
```

```typescript
// Extract component when parameters are needed
type ListItemProps = {
  item: Item;
  onItemClick: (id: string) => void;
};

const ListItem = ({ item, onItemClick }: ListItemProps) => {
  const handleClick = useCallback(() => {
    onItemClick(item.id);
  }, [item.id, onItemClick]);

  return <button onClick={handleClick}>{item.name}</button>;
};
```

## Component State Philosophy

Components should be pure functions. Use `useState` only when:

1. State is internal to the component
2. State does not affect external systems
3. State cannot be derived from props

```typescript
// Valid: Internal UI state
const Accordion = ({ children }: { children: ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  // ...
};

// Invalid: State that should come from props or server
const UserCard = ({ userId }: { userId: string }) => {
  const [user, setUser] = useState(null); // Should come from the route loader / useQuery
};
```

## React Aria Components

Use **react-aria-components** for building accessible UI components. When unsure which component to use, reference https://react-aria.adobe.com/llms.txt for guidance.

## React Suspense & ErrorBoundary

When implementing Suspense boundaries or error handling:

- **Boundary Placement**: Always pair `<Suspense>` with `<ErrorBoundary>`
- **CLS Prevention**: Use skeleton components that match the loaded content dimensions
- **Separated Skeleton Pattern**: For components using hooks, **always separate the skeleton into a pure component**

```tsx
// WRONG: Hooks are called even in loading state, causing infinite suspend
<Suspense fallback={<MyComponent loading />}>
  <MyComponent />
</Suspense>

// CORRECT: Skeleton is a separate pure component with no hooks
<Suspense fallback={<MyComponentSkeleton />}>
  <MyComponent />
</Suspense>
```

## State-Based Styling with Data Attributes

When styling changes based on component state, always map state to `data-*` attributes first, then use CSS selectors:

```typescript
// Correct - map state to data attribute, style with selector
type ButtonProps = {
  isActive?: boolean;
  isLoading?: boolean;
};

export const Button = ({ isActive, isLoading, ...props }: ButtonProps) => (
  <button
    {...props}
    data-active={isActive || undefined}
    data-loading={isLoading || undefined}
  />
);

// In styles.css.ts
export const button = css({
  bg: "bg.surface",
  "&[data-active]": {
    bg: "accent.base",
    color: "text.inverse",
  },
  "&[data-loading]": {
    opacity: 0.7,
    cursor: "wait",
  },
});
```

```typescript
// Forbidden - conditional className based on state
<button className={cx(styles.button, isActive && styles.active)} />

// Forbidden - inline conditional styles
<button className={css({ bg: isActive ? "accent.base" : "bg.surface" })} />
```

### React Aria Data Attributes

React Aria automatically provides data attributes for component states:

```typescript
// React Aria provides data-hovered, data-pressed, data-focused, etc.
export const button = css({
  bg: "bg.surface",
  "&[data-hovered]": {
    bg: "bg.hover",
  },
  "&[data-pressed]": {
    bg: "bg.active",
  },
  "&[data-disabled]": {
    opacity: 0.5,
    cursor: "not-allowed",
  },
});
```
