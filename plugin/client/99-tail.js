    /* ------------------------------------------------------------------ *
     * plugin entry
     * ------------------------------------------------------------------ */

    function apply(rawContext) {
      const ctx = rawContext;
      let workspaceService = null;
      try {
        workspaceService = ctx.get ? ctx.get("uiWorkspace") : null;
      } catch {
        workspaceService = null;
      }
      if (!workspaceService && typeof ctx.inject === "function") {
        try {
          ctx.inject(["uiWorkspace"], (scope) => {
            workspaceService = scope.uiWorkspace || null;
          });
        } catch {
          /* optional service */
        }
      }
      const readWorkspace = () => {
        if (workspaceService) return workspaceService;
        try {
          return ctx.get ? ctx.get("uiWorkspace") : null;
        } catch {
          return null;
        }
      };
      const View = createView(readWorkspace);
      ctx.slots.inject("conversation.view", () =>
        ctx.slots.register(
          { name: "conversation.view", id: VIEW_ID, order: ORDER, label: () => VIEW_LABEL },
          View,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
