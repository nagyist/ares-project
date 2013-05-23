enyo.kind({
	name: "Ares.App",
	classes: "enyo-fit",
	id: "aresApp",
	handlers: {
		ondragleave: "iframeDragleave",
		onWebkitTransitionEnd: "prerenderMoveComplete" // TODO
	},
	published: {
		containerItem: null,
		beforeItem: null,
		currentDropTarget: null,
		createPaletteItem: null
	},
	components: [
		{name: "client", classes:"enyo-fit"},
		{name: "cloneArea", style: "background:rgba(0,200,0,0.5); display:none; opacity: 0;", classes: "enyo-fit enyo-clip"},
		{name: "flightArea", style: "display:none;", classes: "enyo-fit"},
		{name: "serializer", kind: "Ares.Serializer"},
		{name: "communicator", kind: "RPCCommunicator", onMessage: "receiveMessage"},
		{name: "selectHighlight", classes: "iframe-highlight iframe-select-highlight"},
		{name: "dropHighlight", classes: "iframe-highlight iframe-drop-highlight"}
	],
	
	selection: null,
	parentInstance: null,
	containerData: null,
	aresComponents: [],
	prevX: null,
	prevY: null,
	dragoverTimeout: null,
	holdoverTimeout: null,
	moveControlSecs: 0.2,
	edgeThresholdPx: 10,
	debug: false,
	
	create: function() {
		this.inherited(arguments);
		this.addHandlers();
		this.addDispatcherFeature();
	},
	rendered: function() {
		this.inherited(arguments);
		this.sendMessage({op: "state", val: "initialized"});
	},
	currentDropTargetChanged: function() {
		if (this.getCurrentDropTarget()) {
			this.highlightDropTarget(this.getCurrentDropTarget());
		}
		this.syncDropTargetHighlighting();
	},
	//* Add dispatch handling for native drag events
	addHandlers: function(inSender, inEvent) {
		document.ondragstart = enyo.dispatch;
		document.ondrag =      enyo.dispatch;
		document.ondragenter = enyo.dispatch;
		document.ondragleave = enyo.dispatch;
		document.ondragover =  enyo.dispatch;
		document.ondrop =      enyo.dispatch;
		document.ondragend =   enyo.dispatch;
	},
	/**
		Add feature to dispatcher to catch drag-and-drop-related events, and
		to stop any/all DOM events from being handled by the app.
	*/
	addDispatcherFeature: function() {
		var _this = this;
		
		enyo.dispatcher.features.push(
			function(e) {
				//console.log("-->", e.type);
				if (_this[e.type]) {
					_this[e.type](e)
				}
				e.preventDispatch = true;
				return true;
			}
		);
	},
	//* Send message to Deimos via _this.$.communicator_
	sendMessage: function(inMessage) {
		this.$.communicator.sendMessage(inMessage);
	},
	//* Receive message from Deimos
	receiveMessage: function(inSender, inEvent) {

		var msg = inEvent.message;

		if (!msg || !msg.op) {
			enyo.warn("Deimos iframe received invalid message data:", msg);
			return;
		}		
			
		switch (msg.op) {
			case "containerData":
				this.setContainerData(msg.val);
				break;
			case "render":
				this.renderKind(msg.val);
				break;
			case "select":
				this.selectItem(msg.val);
				break;
			case "highlight":
				this.highlightDropTarget(this.getControlById(msg.val.aresId));
				break;
			case "unhighlight":
				this.unhighlightDropTargets(msg.val);
				break;
			case "modify":
				this.modifyProperty(msg.val);
				break;
			case "codeUpdate":
				this.codeUpdate(msg.val);
				break;
			case "cssUpdate":
				this.cssUpdate(msg.val);
				break;
			case "cleanUp":
				this.cleanUpKind();
				break;
			case "resize":
				this.resized();
				break;
			case "prerenderDrop":
				this.foreignPrerenderDrop(msg.val);
				break;
			case "enterCreateMode":
				this.enterCreateMode(msg.val);
				break;
			case "leaveCreateMode":
				this.leaveCreateMode();
				break;
			default:
				enyo.warn("Deimos iframe received unknown message op:", msg);
				break;
		}
	},
	//* On down, set _this.selection_
	down: function(e) {
		var dragTarget = this.getEventDragTarget(e.dispatchTarget);
		
		if (dragTarget && dragTarget.aresComponent) {
			this._selectItem(dragTarget);
		}
	},
	//* On drag start, set the event _dataTransfer_ property to contain a serialized copy of _this.selection_
	dragstart: function(e) {
		if (!e.dataTransfer) {
			return false;
		}
		
		// Set drag data
		e.dataTransfer.setData('ares/moveitem', this.$.serializer.serializeComponent(this.selection, true));

		// Hide the drag image ghost
		e.dataTransfer.setDragImage(this.createDragImage(), 0, 0);

        return true;
	},
	//* On drag over, enable HTML5 drag-and-drop if there is a valid drop target
	dragover: function(inEvent) {
		var dropTarget,
			mouseMoved,
			dataType
		;
		
		if (!inEvent.dataTransfer) {
			return false;
		}
		
		// Enable HTML5 drag-and-drop
		inEvent.preventDefault();
		
		// Update dragover highlighting
		this.dragoverHighlighting(inEvent);
		
		// Don't do holdover if item is being dragged in from the palette
		if (inEvent.dataTransfer.types[0] === "ares/createitem") {
			return true;
		}
		
		// If dragging in an absolute positioning container, go straight to _holdOver()_
		if (this.absolutePositioningMode(this.getCurrentDropTarget())) {
			this.holdOver(inEvent);
			
			// If mouse actually moved, begin timer for holdover
		} else if (this.mouseMoved(inEvent)) {
			this.resetHoldoverTimeout();
			
			// If mouse hasn't moved and timer isn't yet set, set it
		} else if (!this.holdoverTimeout) {
			this.holdoverTimeout = setTimeout(enyo.bind(this, function() { this.holdOver(inEvent); }), 200);
		}
		
		// Remember mouse location for next dragover event
		this.saveMouseLocation(inEvent);
		
		return true;
	},
	dragenter: function(inEvent) {
		// Enable HTML5 drag-and-drop
		inEvent.preventDefault();
	},
	//* On drag leave, unhighlight previous drop target
	dragleave: function(inEvent) {
		var dropTarget;
		
		if (!inEvent.dataTransfer) {
			return false;
		}
		
		dropTarget = this.getEventDropTarget(inEvent.dispatchTarget);

		if (!this.isValidDropTarget(dropTarget)) {
			return false;
		}
		
		this.setCurrentDropTarget(null);
		this.syncDropTargetHighlighting();
		
		return true;
	},
	
	//* On drop, either move _this.selection_ or create a new component
	drop: function(inEvent) {
		if (!inEvent.dataTransfer) {
			return true;
		}
		
		var dataType = inEvent.dataTransfer.types[0],
			dropData = enyo.json.codify.from(inEvent.dataTransfer.getData(dataType)),
			dropTargetId,
			dropTarget = this.getEventDropTarget(inEvent.dispatchTarget),
			beforeId
		;
		
		switch (dataType) {
			case "ares/moveitem":
				dropTargetId = (dropTarget) ? dropTarget.aresId : this.selection.parent.aresId;
				beforeId = this.selection.addBefore ? this.selection.addBefore.aresId : null;
				this.sendMessage({op: "moveItem", val: {itemId: dropData.aresId, targetId: dropTargetId, beforeId: beforeId, layoutData: this.getLayoutData(inEvent)}});
				break;
			
			case "ares/createitem":
				dropTargetId = this.getContainerItem() ? this.getContainerItem().aresId : this.getEventDropTarget(inEvent.dispatchTarget).aresId;
				beforeId = this.getBeforeItem() ? this.getBeforeItem().aresId : null;
				this.sendMessage({op: "createItem", val: {config: dropData.config, targetId: dropTargetId, beforeId: beforeId}});
				break;
			
			default:
				enyo.warn("Component view received unknown drop: ", dataType, dropData);
				break;
		}
		
		this.setContainerItem(null);
		this.setBeforeItem(null);
		
		return true;
	},
	dragend: function() {
		this.setCurrentDropTarget(null);
		this.syncDropTargetHighlighting();
		this.unhighlightDropTargets();
		this.clearDragImage();
	},
	createDragImage: function() {
		this.dragImage = document.createElement();
		return this.dragImage;
	},
	clearDragImage: function() {
		this.dragImage = null;
	},	
	resetHoldoverTimeout: function() {
		clearTimeout(this.holdoverTimeout);
		this.holdoverTimeout = null;
		
		if (this.selection && this.selection.addBefore) {
			this.resetAddBefore();
		}
	},
	//* Reset the control currently set as _addBefore_ on _this.selection_
	resetAddBefore: function() {
		this.selection.addBefore = null;
	},
	mouseMoved: function(inEvent) {
		return (this.prevX !== inEvent.clientX || this.prevY !== inEvent.clientY);
	},
	saveMouseLocation: function(inEvent) {
		this.prevX = inEvent.clientX;
		this.prevY = inEvent.clientY;
	},
	dragoverHighlighting: function(inEvent) {
		var dropTarget = this.getEventDropTarget(inEvent.dispatchTarget);
		
		// Deselect the currently selected item if we're creating a new item, so all items are droppable
		if (inEvent.dataTransfer.types[0] == "ares/createitem") {
			this.selection = null;
			this.hideSelectHighlight();
		}
		
		// If not a valid drop target, reset _this.currentDropTarget_
		if (!this.isValidDropTarget(dropTarget)) {
			this.setCurrentDropTarget(null);
			return false;
		}
		
		// If drop target has changed, update drop target highlighting
		if (!(this.currentDropTarget && this.currentDropTarget === dropTarget)) {
			this.setCurrentDropTarget(dropTarget);
		}
	},
	//* Save _inData_ as _this.containerData_ to use as a reference when creating drop targets.
	setContainerData: function(inData) {
		this.containerData = inData;
		this.sendMessage({op: "state", val: "ready"});
	},
	//* Render the specified kind
	renderKind: function(inKind) {
		var errMsg;
		
		try {
			var kindConstructor = enyo.constructorForKind(inKind.name);

			if (!kindConstructor) {
				errMsg = "No constructor exists for ";
				enyo.warn(errMsg, inKind.name);
				this.sendMessage({op: "error", val: {msg: errMsg + inKind.name}});
				return;
			} else if(!kindConstructor.prototype) {
				errMsg = "No prototype exists for ";
				enyo.warn(errMsg, inKind.name);
				this.sendMessage({op: "error", val: {msg: errMsg + inKind.name}});
				return;
			}

			/*
				Stomp on existing _kindComponents_ to ensure that we render exactly what the user
				has defined. If components came in as a string, convert to object first.
			*/
			kindConstructor.prototype.kindComponents = (typeof inKind.components === "string") ? enyo.json.codify.from(inKind.components) : inKind.components;

			// Clean up after previous kind
			if (this.parentInstance) {
				this.cleanUpPreviousKind(inKind.name);
			}

			// Proxy Repeater and List
			this.manageComponentsOptions(kindConstructor.prototype.kindComponents);
			// Save this kind's _kindComponents_ array
			this.aresComponents = this.flattenKindComponents(kindConstructor.prototype.kindComponents);

			// Enable drag/drop on all of _this.aresComponents_
			this.makeComponentsDragAndDrop(this.aresComponents);

			// Save reference to the parent instance currently rendered
			this.parentInstance = this.$.client.createComponent({kind: inKind.name});

			// Mimic top-level app fitting (as if this was rendered with renderInto or write)
			if (this.parentInstance.fit) {
				this.parentInstance.addClass("enyo-fit enyo-clip");
			}
			this.parentInstance.render();
			
			// Notify Deimos that the kind rendered successfully
			this.kindUpdated();
			
			// Select a control if so requested
			if (inKind.selectId) {
				this.selectItem({aresId: inKind.selectId});
			}
		} catch(error) {
			errMsg = "Unable to render " + inKind.name;
			this.error(errMsg, error);
			this.sendMessage({op: "error", val: {msg: errMsg}});
		}
	},
	//* Rerender current selection
	rerenderKind: function() {
		this.renderKind({name: this.parentInstance.kind, components: this.getSerializedCopyOfComponent(this.parentInstance).components});
	},
	//* When the designer is closed, clean up the last rendered kind
	cleanUpKind: function() {
		// Clean up after previous kind
		if(this.parentInstance) {
			this.cleanUpPreviousKind(null);
			this.parentInstance = null;
			this.selection = null;
		}
		
	},
	//* Clean up previously rendered kind
	cleanUpPreviousKind: function(inKindName) {
		// Save changes made to components into previously rendered kind's _kindComponents_ array
		if(this.parentInstance.kind !== inKindName) {
			enyo.constructorForKind(this.parentInstance.kind).prototype.kindComponents = enyo.json.codify.from(this.$.serializer.serialize(this.parentInstance, true));
		}
		
		// Reset flags on previously rendered kind's _kindComponents_ array
		this.unflagAresComponents();
		
		// Clear previously rendered kind
		this.$.client.destroyClientControls();
		
		// Remove selection and drop highlighting
		this.hideSelectHighlight();
		this.unhighlightDropTargets();
	},
	resized: function() {
		this.inherited(arguments);
		this.highlightSelection();
	},
	/**
		Response to message sent from Deimos. Highlight the specified conrol
		and send a message with a serialized copy of the control.
	*/
	selectItem: function(inItem) {
		if(!inItem) {
			return;
		}
		
		for(var i=0, c;(c=this.flattenChildren(this.$.client.children)[i]);i++) {
			if(c.aresId === inItem.aresId) {
				this._selectItem(c);
				return;
			}
		}
	},
	//* Update _this.selection_ property value based on change in Inspector
	modifyProperty: function(inData) {
		if (typeof inData.value === "undefined") {
			this.removeProperty(inData.property);
		} else {
			this.updateProperty(inData.property, inData.value);
		}
		this.rerenderKind();
		this.selectItem(this.selection);
	},
	removeProperty: function(inProperty) {
		delete this.selection[inProperty];
	},
	updateProperty: function(inProperty, inValue) {
		var options = this.selection.__aresOptions;
		if (options && options.isRepeater && (inProperty === "onSetupItem" || inProperty === "count")) {
			// DO NOT APPLY changes to the properties mentioned above
			// TODO: could be managed later on thru config in .design files if more than one kind need special processings.
			this.debug && this.log("Skipping modification of \"" + inProperty + "\"");
		} else {
			this.selection[inProperty] = inValue;
		}
	},
	
	//* Get each kind component individually
	flattenKindComponents: function(inComponents) {
		var ret = [],
			cs,
			c;
		
		if(!inComponents) {
			return ret;
		}
		
		for (var i=0;(c = inComponents[i]);i++) {
			ret.push(c);
			if(c.components) {
				cs = this.flattenKindComponents(c.components);
				for (var j=0;(c = cs[j]);j++) {
					ret.push(c);
				}
			}
		}
		
		return ret;
	},
	manageComponentsOptions: function(inComponents) {
		var c;
		for (var i=0;(c = inComponents[i]);i++) {
			this.manageComponentOptions(c);
			if (c.components) {
				this.manageComponentsOptions(c.components);
			}
		}
	},
	manageComponentOptions: function(inComponent) {
		if (inComponent.__aresOptions) {
			var options = inComponent.__aresOptions;
			if (options.isRepeater === true) {
				/*
					We are handling a Repeater or a List.
					Force "count" to 1 and invalidate "onSetupItem" to
					manage them correctly in the Designer
				 */
				this.debug && this.log("Manage repeater " + inComponent.kind, inComponent);
				inComponent.count = 1;
				inComponent.onSetupItem = "aresUnImplemetedFunction";
			}
		}
	},
	// TODO - merge this with flattenKindComponents()
	flattenChildren: function(inComponents) {
		var ret = [],
			cs,
			c;
		
		for (var i=0;(c = inComponents[i]);i++) {
			ret.push(c);
			if(c.children) {
				cs = this.flattenChildren(c.children);
				for (var j=0;(c = cs[j]);j++) {
					ret.push(c);
				}
			}
		}
		
		return ret;
	},
	
	//* Set up drag and drop attributes for component in _inComponents_
	makeComponentsDragAndDrop: function(inComponents) {
		for(var i=0, component;(component = inComponents[i]);i++) {
			this.makeComponentDragAndDrop(component);
		}
	},
	//* Set up drag and drop for _inComponent_
	makeComponentDragAndDrop: function(inComponent) {
		this.makeComponentDraggable(inComponent);
		this.makeComponentADropTarget(inComponent);
		this.flagAresComponent(inComponent);
	},
	//* Add the attribute _draggable="true"_ to _inComponent_
	makeComponentDraggable: function(inComponent) {
		if(inComponent.attributes) {
			inComponent.attributes.draggable =  true;
		} else {
			inComponent.attributes = {
				draggable:  true
			};
		}
	},
	/**
		Add the attribute _dropTarget="true"_ to _inComponent_ if it wasn't explicitly set
		to false in the design.js file (works as an opt out).
	*/
	makeComponentADropTarget: function(inComponent) {
		if(inComponent.attributes) {
			// TODO: Revisit this, once indexer's propertyMetaData is integrated
			inComponent.attributes.dropTarget = true; //(this.containerData[inComponent.kind] !== false);
		} else {
			inComponent.attributes = {
				dropTarget: (this.containerData[inComponent.kind] !== false)
			};
		}
	},
	flagAresComponent: function(inComponent) {
		inComponent.aresComponent = true;
	},
	//* Remove _aresComponent_ flag from previously used _this.aresComponents_ array
	unflagAresComponents: function() {
		for(var i=0, component;(component = this.aresComponents[i]);i++) {
			delete component.aresComponent;
		}
	},
	
	isValidDropTarget: function(inControl) {
		return (inControl && inControl !== this.selection && !inControl.isDescendantOf(this.selection));
	},
	getControlById: function(inId, inContainer) {
		inContainer = inContainer || this.$.client;
		for(var i=0, c;(c=this.flattenChildren(inContainer.children)[i]);i++) {
			if(c.aresId === inId) {
				return c;
			}
		}
	},
	
	getEventDragTarget: function(inComponent) {
		return (!inComponent) ? null : (!this.isDraggable(inComponent)) ? this.getEventDragTarget(inComponent.parent) : inComponent;
	},
	getEventDropTarget: function(inComponent) {
		return (!inComponent) ? null : (inComponent === this.parentInstance) ? this.parentInstance : (!this.isDropTarget(inComponent)) ? this.getEventDropTarget(inComponent.parent) : inComponent;
	},
	isDraggable: function(inComponent) {
		return (inComponent.attributes && inComponent.attributes.draggable);
	},
	isDropTarget: function(inComponent) {
		return (inComponent.attributes && inComponent.attributes.dropTarget);
	},
	
	//* Highlight _inComponent_ with drop target styling, and unhighlight everything else
	highlightDropTarget: function(inComponent) {
		this.$.dropHighlight.setShowing(true);
		this.$.dropHighlight.setBounds(inComponent.hasNode().getBoundingClientRect());
	},
	unhighlightDropTargets: function() {
		this.$.dropHighlight.setShowing(false);
	},
	//* Highlight _this.selection_ with selected styling, and unhighlight everything else
	highlightSelection: function() {
		this.unhighlightDropTargets();
		this.renderSelectHighlight();
	},
	renderSelectHighlight: function() {
		if(this.selection && this.selection.hasNode()) {
			this.$.selectHighlight.setBounds(this.selection.hasNode().getBoundingClientRect());
			this.$.selectHighlight.show();
		}
	},
	hideSelectHighlight: function() {
		this.$.selectHighlight.hide();
	},
	syncDropTargetHighlighting: function() {
		var dropTarget = this.currentDropTarget ? this.$.serializer.serializeComponent(this.currentDropTarget, true) : null;
		this.sendMessage({op: "syncDropTargetHighlighting", val: dropTarget});
	},
	//* Set _inItem_ to _this.selected_ and notify Deimos
	_selectItem: function(inItem, noMessage) {
		this.selection = inItem;
		this.highlightSelection();
		if (noMessage) {
			return;
		}
		this.sendMessage({op: "select",	 val: this.$.serializer.serializeComponent(this.selection, true)});
	},
	/**
		Find any children in _inControl_ that match kind components of the parent instance,
		and make them drag/droppable (if appropriate)
	*/
	setupControlDragAndDrop: function(inControl) {
		var childComponents = this.flattenChildren(inControl.children),
			i,
			j;
		
		this.makeComponentDragAndDrop(inControl);
		
		for(i=0;i<childComponents.length;i++) {
			for(j=0;j<this.aresComponents.length;j++) {
				if(childComponents[i].aresId === this.aresComponents[j].aresId) {
					this.makeComponentDragAndDrop(childComponents[i]);
				}
			}
		}
	},
	//* Create object that is a copy of the passed in component
	getSerializedCopyOfComponent: function(inComponent) {
		return enyo.json.codify.from(this.$.serializer.serializeComponent(inComponent, true));
	},
	//* Rerender client, reselect _this.selection_, and notify Deimos
	refreshClient: function(noMessage) {
		this.$.client.render();
		
		if(!noMessage) {
			this.kindUpdated();
		}
		
		this.selectItem(this.selection);
	},
	//* Send update to Deimos with serialized copy of current kind component structure
	kindUpdated: function() {
		this.sendMessage({op: "rendered", val: this.$.serializer.serialize(this.parentInstance, true)});
	},
	//* Eval code passed in by designer
	codeUpdate: function(inCode) {
		eval(inCode);
	},
	//* Update CSS by replacing the link/style tag in the head with an updated style tag
	cssUpdate: function(inData) {
		if(!inData.filename || !inData.code) {
			enyo.warn("Invalid data sent for CSS update:", inData);
			return;
		}
		
		var filename = inData.filename,
			code = inData.code,
			head = document.getElementsByTagName("head")[0],
			links = head.getElementsByTagName("link"),
			styles = head.getElementsByTagName("style"),
			el,
			i
		;
		
		// Look through link tags for a linked stylesheet with a filename matching _filename_
		for(i=0;(el = links[i]);i++) {
			if(el.getAttribute("rel") === "stylesheet" && el.getAttribute("type") === "text/css" && el.getAttribute("href") === filename) {
				this.updateStyle(filename, code, el);
				return;
			}
		}
		
		// Look through style tags for a tag with a data-href property matching _filename_
		for(i=0;(el = styles[i]);i++) {
			if(el.getAttribute("data-href") === filename) {
				this.updateStyle(filename, code, el);
				return;
			}
		}
	},
	//* Replace _inElementToReplace_ with a new style tag containing _inNewCode_
	updateStyle: function(inFilename, inNewCode, inElementToReplace) {
		var head = document.getElementsByTagName("head")[0],
			newTag = document.createElement("style");
		
		newTag.setAttribute("type", "text/css");
		newTag.setAttribute("data-href", inFilename);
		newTag.innerHTML = inNewCode;
		
		head.insertBefore(newTag, inElementToReplace);
		head.removeChild(inElementToReplace);
	},
	enterCreateMode: function(inData) {
		this.setCreatePaletteItem(inData);
	},
	leaveCreateMode: function() {
		this.setCreatePaletteItem(null);
	},
	
	
	
	
	
	
	
	
	
	
	
	
	
	holdOver: function(inEvent) {
		var container = this.getCurrentDropTarget();
		
		if (!container) {
			return;
		}
		
		if (this.absolutePositioningMode(container)) {
			this.absolutePositioningHoldover(inEvent, container);
		} else {
			this.staticPositioningHoldover(inEvent, container);
		}
	},
	absolutePositioningHoldover: function(inEvent, inContainer) {
		this.setContainerItem(inContainer);
		this.setBeforeItem(null);
		this.absolutePrerenderDrop(inEvent);
	},
	absolutePrerenderDrop: function(inEvent) {
		var x = this.getAbsoluteXPosition(inEvent),
			y = this.getAbsoluteYPosition(inEvent)
		;
		
		this.moveSelectionToAbsolutePosition(x, y);
	},
	// Move selection to new position
	moveSelectionToAbsolutePosition: function(inX, inY) {
		var container   = this.getContainerItem(),
			containerId = container ? container.aresId : null,
			clone       = this.cloneControl(this.selection), //this.createSelectionGhost(this.selection)
			styleProps	= this.createStyleArrayFromString(this.selection.style),
			topMatched 	= rightMatched = bottomMatched = leftMatched = false
		;
		
		this.hideSelectHighlight();
		
		this.selection.destroy();
		this.selection = container.createComponent(clone).render();
		this.selection.applyStyle("position", "absolute");
		this.selection.applyStyle("pointer-events", "none");
		this.addVerticalPositioning(this.selection, inY);
		this.addHorizontalPositioning(this.selection, inX);
	},
	//* Add appropriate vertical positioning to _inControl_ based on _inY_
	addVerticalPositioning: function(inControl, inY) {
		var container 		= this.getContainerItem(),
			styleProps 		= this.createStyleArrayFromString(inControl.style),
			containerBounds = this.getRelativeBounds(container),
			controlBounds 	= this.getRelativeBounds(inControl),
			topMatched 		= this.findStyleMatch(styleProps, "top"),
			bottomMatched 	= this.findStyleMatch(styleProps, "bottom")
		;
		
		if (bottomMatched) {
			inControl.applyStyle("bottom", (containerBounds.height - inY - controlBounds.height) + "px");
		}
		if (topMatched || (!topMatched && !bottomMatched)) {
			inControl.applyStyle("top", inY + "px");
		}
	},
	//* Add appropriate horizontal positioning to _inControl_ based on _inX_
	addHorizontalPositioning: function(inControl, inX) {
		var container 		= this.getContainerItem(),
			styleProps 		= this.createStyleArrayFromString(inControl.style),
			containerBounds = this.getRelativeBounds(container),
			controlBounds 	= this.getRelativeBounds(inControl),
			leftMatched	 	= this.findStyleMatch(styleProps, "left"),
			rightMatched 	= this.findStyleMatch(styleProps, "right")
		;
		
		if (rightMatched) {
			inControl.applyStyle("right", (containerBounds.width - inX - controlBounds.width) + "px");
		}
		if (leftMatched || (!leftMatched && !rightMatched)) {
			inControl.applyStyle("left", inX + "px");
		}
	},
	createStyleArrayFromString: function(inStyleStr) {
		var styleProps = inStyleStr.split(";");
		
		for (var i = 0; i < styleProps.length; i++) {
			styleProps[i] = styleProps[i].split(":");
			if (styleProps[i].length <= 1) {
				styleProps.splice(i,1);
				i--;
				continue;
			}
			
			// Trim whitespace from prop and val
			styleProps[i][0] = this.trimWhitespace(styleProps[i][0]);
			styleProps[i][1] = this.trimWhitespace(styleProps[i][1]);
		}
		
		return styleProps;
	},
	createStyleStringFromArray: function(inStyleArray) {
		var styleStr = "",
			i;
		
		// Compose style string
		for (i = 0; i < inStyleArray.length; i++) {
			if (i > 0) {
				styleStr += " ";
			}
			
			styleStr += inStyleArray[i][0] + ": " + inStyleArray[i][1] + ";";
		}
		
		return styleStr;
	},
	trimWhitespace: function(inStr) {
		return inStr.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
	},
	//* Look for a property in styleArr that matches inProp
	findStyleMatch: function(inStyleArr, inProp) {
		for (var i = 0; i < inStyleArr.length; i++) {
			if (inStyleArr[i][0].match(inProp)) {
				return true;
			}
		}
		return false;
	},
	staticPositioningHoldover: function(inEvent, inContainer) {
		var x = inEvent.clientX,
			y = inEvent.clientY,
			onEdge = this.checkDragOverBoundary(inContainer, x, y),
			beforeItem;
		
		if (onEdge < 0) {
			beforeItem = inContainer;
			inContainer = inContainer.parent;
		} else if (onEdge > 0) {
			beforeItem = this.findAfterItem(inContainer.parent, inContainer, x, y);
			inContainer = inContainer.parent;
		} else {
			beforeItem = (inContainer.children.length > 0) ? this.findBeforeItem(inContainer, x, y) : null;
			inContainer = inContainer;
		}
		
		this.setContainerItem(inContainer);
		this.setBeforeItem(beforeItem);
		this.staticPrerenderDrop();
	},
	//* Handle drop that has been trigged from outside of the iframe
	foreignPrerenderDrop: function(inData) {
		var containerItem = this.getControlById(inData.targetId),
			beforeItem    = inData.beforeId ? this.getControlById(inData.beforeId) : null
		;
		
		this.setContainerItem(containerItem);
		this.setBeforeItem(beforeItem);
		
		// Do static prerender drop if not an AbsolutePositioningLayout container
		if (!(containerItem && containerItem.layoutKind === "AbsolutePositioningLayout")) {
			this.staticPrerenderDrop();
		}
	},
	staticPrerenderDrop: function() {
		var movedControls, movedInstances;
		
		// If not a legal drop, do nothing
		if (!this.legalDrop()) {
			return;
		}
		
		// Create copy of app in post-move state
		this.renderUpdatedAppClone();
		
		// Figure which controls need to move to get to the new state
		movedControls = this.getMovedControls();
		
		// Hide app copy
		this.hideUpdatedAppClone();
		
		// Move (hidden) selected control to new position
		this.moveSelection();
		
		// Hide any controls that need to be moved
		movedInstances = this.hideMovedControls(movedControls);
		
		// Turn off selection/drop area highlighting
		this.hideSelectHighlight();
		this.unhighlightDropTargets();
		
		// Create copies of controls that need to move, and animate them to the new posiitions
		this.animateMovedControls(movedControls);

		// When animation completes, udpate parent instance to reflect changes. TODO - don't use setTimeout, do this on an event when the animation completes
		setTimeout(enyo.bind(this, function() { this.prerenderMoveComplete(movedInstances); }), this.moveControlSecs*1000 + 100);
	},
	prerenderMoveComplete: function(inInstances) {
		// Hide layer with flying controls
		this.$.flightArea.hide();
		// Show hidden controls in app
		this.showMovedControls(inInstances);
		// Point _this.parentInstance_ to current client controls
		this.parentInstance = this.$.client.getClientControls()[0];
	},
	legalDrop: function() {
		var containerId = (this.getContainerItem()) ? this.getContainerItem().aresId : null,
			beforeId    = (this.getBeforeItem())    ? this.getBeforeItem().aresId    : null;
		
		// If creating a new item, drop is legal
		if (this.getCreatePaletteItem()) {
			return true;
		}
		
		if ((!this.getContainerItem() || !this.selection) || this.selection.aresId === containerId || this.selection.aresId === beforeId) {
			return false;
		}
		
		return true;
	},
	//* Return all controls that will be affected by this move
	getMovedControls: function() {
		var originalPositions = this.getControlPositions(this.$.client.children),
			updatedPositions  = this.getControlPositions(this.$.cloneArea.children),
			movedControls     = [],
			originalItem,
			updatedItem,
			i,
			j;
		
		for (i = 0; (originalItem = originalPositions[i]); i++) {
			for (j = 0; (updatedItem = updatedPositions[j]); j++) {
				if (originalItem.comp.aresId === updatedItem.comp.aresId && !this.rectsAreEqual(originalItem.rect, updatedItem.rect)) {
					movedControls.push({
						comp:      originalItem.comp,
						origStyle: this.cloneCSS(enyo.dom.getComputedStyle(originalItem.comp.hasNode())),
						newStyle:  this.cloneCSS(enyo.dom.getComputedStyle(updatedItem.comp.hasNode())),
						origRect:  originalItem.rect,
						newRect:   updatedItem.rect
					});
				}
			}
		}
		
		return movedControls;
	},
	cloneCSS: function(inCSS) {
		for(var i = 0, cssText = ""; i < inCSS.length; i++) {
			if (
					inCSS[i] === "position" ||
					inCSS[i] === "top" ||
					inCSS[i] === "left" ||
					inCSS[i] === "-webkit-transition-duration" ||
					inCSS[i] === "-webkit-transition-property"
				) {
				continue;
			}
			cssText += inCSS[i] + ": " + inCSS.getPropertyValue(inCSS[i]) + "; ";
		}
		return cssText;
	},
	hideMovedControls: function(inControls) {
		var originalControls = this.flattenChildren(this.$.client.children),
			hiddenControls = [];
			
		for (var i = 0; i < originalControls.length; i++) {
			if (!originalControls[i].aresId) {
				continue;
			}
			for (var j = 0; j < inControls.length; j++) {
				if (inControls[j].comp.aresId && originalControls[i].aresId === inControls[j].comp.aresId) {
					originalControls[i].applyStyle("opacity", "0");
					hiddenControls.push(originalControls[i]);
				}
			}
		}
		
		return hiddenControls;
	},
	// Move selection to new position
	moveSelection: function() {
		var containerId = (this.getContainerItem()) ? this.getContainerItem().aresId : null,
			container   = this.getControlById(containerId),
			beforeId    = (this.getBeforeItem()) ? this.getBeforeItem().aresId : null,
			before      = (beforeId) ? this.getControlById(beforeId) : null,
			clone       = this.cloneControl(this.selection); //this.createSelectionGhost(this.selection);
		
		// If the selection should be moved before another item, use the _addBefore_ property
		if (before) {
			clone = enyo.mixin(clone, {beforeId: beforeId, addBefore: before});
		}
		
		// If the selection has absolute positioning applied, remove it
		if (clone.style) {
			clone.style = this.removeAbsolutePositioningStyle(clone);
		}
		
		this.selection.destroy();
		this.selection = container.createComponent(clone).render();
	},
	removeAbsolutePositioningStyle: function(inControl) {
		var currentStyle = inControl.style || "",
			styleProps = currentStyle.split(";"),
			updatedProps = [],
			prop,
			i;
		
		for (i = 0; i < styleProps.length; i++) {
			prop = styleProps[i].split(":");
			if (prop[0].match(/position/) || prop[0].match(/top/) || prop[0].match(/left/)) {
				continue;
			}
			updatedProps.push(styleProps[i]);
		}
		
		for (i = 0, currentStyle = ""; i < updatedProps.length; i++) {
			currentStyle += updatedProps[i];
		}
		
		return currentStyle;
	},
	//* Draw controls that will do aniumating at starting points and then kick off animation
	animateMovedControls: function(inControls) {
		this.renderAnimatedControls(inControls);
		this.animateAnimatedControls();
	},
	renderAnimatedControls: function(inControls) {
		// Clean up existing animated controls
		this.$.flightArea.destroyClientControls();
		
		// Create a copy of each control that is being moved
		for (var i = 0, control; i < inControls.length; i++) {
			if (inControls[i].comp.aresId === this.selection.aresId) {
				control = this.$.flightArea.createComponent(
					{
						kind:     "enyo.Control",
						aresId:   inControls[i].comp.aresId,
						moveTo:   inControls[i].newRect,
						newStyle: inControls[i].newStyle
					}
				);
				control.addStyles("z-index:1000;");
			} else {
				control = this.$.flightArea.createComponent(
					{
						kind:     inControls[i].comp.kind,
						content:  inControls[i].comp.getContent(),
						aresId:   inControls[i].comp.aresId,
						moveTo:   inControls[i].newRect,
						newStyle: inControls[i].newStyle
					}
				);
			}
			
			// Set the starting top/left values and props to enable animation
			control.addStyles(
				inControls[i].origStyle +
				"position: absolute; " +
				"top: "  + inControls[i].origRect.top  + "px; " +
				"left: " + inControls[i].origRect.left + "px; " +
				"-webkit-transition-duration: " + this.moveControlSecs + "s; " +
				"-webkit-transition-property: all; "
			);
		}
		
		// Render animated controls
		this.$.flightArea.render().applyStyle("display", "block");
	},
	animateAnimatedControls: function() {
		var controls = this.$.flightArea.getClientControls();
		setTimeout(function() {
			for(var i=0;i<controls.length;i++) {
				controls[i].addStyles(
					controls[i].newStyle +
					"position: absolute; " +
					"top: "  + controls[i].moveTo.top  + "px; " +
					"left: " + controls[i].moveTo.left + "px; "
				);
				controls[i].render();
			}
		}, 0);
	},
	//* Show controls that were hidden for the move
	showMovedControls: function(inControls) {
		for (var i = 0; i < inControls.length; i++) {
			inControls[i].applyStyle("opacity", "1");
		}
	},
	//* Render updated copy of the parentInstance into _cloneArea_
	renderUpdatedAppClone: function() {
		this.$.cloneArea.destroyClientControls();
		this.$.cloneArea.applyStyle("display", "block");
		var appClone = this.$.cloneArea.createComponent(this.cloneControl(this.parentInstance));
		
		// Mimic top-level app fitting (as if this was rendered with renderInto or write)
		if (this.parentInstance.fit) {
			appClone.addClass("enyo-fit enyo-clip");
		}
		this.$.cloneArea.render();
		
		var containerId = (this.getContainerItem()) ? this.getContainerItem().aresId : null,
			container   = this.getControlById(containerId, this.$.cloneArea),
			beforeId    = (this.getBeforeItem()) ? this.getBeforeItem().aresId : null,
			before      = (beforeId) ? this.getControlById(beforeId, this.$.cloneArea) : null,
			selection   = this.getControlById(this.selection.aresId, this.$.cloneArea),
			clone       = this.cloneControl(this.selection); //this.createSelectionGhost(selection);
		
		if (before) {
			clone = enyo.mixin(clone, {beforeId: beforeId, addBefore: before});
		}
		
		// If the selection has absolute positioning applied, remove it
		if (clone.style) {
			clone.style = this.removeAbsolutePositioningStyle(clone);
		}
		
		container.createComponent(clone).render();
		
		if (selection) {
			selection.destroy();
		}
	},
	hideUpdatedAppClone: function() {
		this.$.cloneArea.destroyClientControls();
		this.$.cloneArea.applyStyle("display", "none");
	},
	//* TODO - This createSelectionGhost is WIP
	createSelectionGhost: function (inItem) {
		var computedStyle = enyo.dom.getComputedStyle(inItem.hasNode()),
			rect = inItem.hasNode().getBoundingClientRect(),
			borderWidth = 1,
			height,
			style;
		
		if (!computedStyle) {
			enyo.warn("Attempted to clone item with no node: ", inItem);
			return null;
		}
		
		this.log("h: ", parseInt(computedStyle.height), "w: ", parseInt(computedStyle.width), "p: ", parseInt(computedStyle.padding), "m: ", parseInt(computedStyle.margin));
		
		style = "width: "   + computedStyle.width + "; " +
				"height: "  + computedStyle.height + "; " +
				//"margin: "  + computedStyle.margin + "; " +
				//"padding: " + computedStyle.padding + "; " +
				"border: "  + borderWidth + "px dotted black; " +
				"display: " + computedStyle.display + "; " +
				"background: rgba(255,255,255,0.8); ";
		
		return {
			kind:   "enyo.Control",
			aresId: inItem.aresId,
			style:  style
		};
	},
	cloneControl: function(inSelection) {
		return {
			kind:       inSelection.kind,
			layoutKind: inSelection.layoutKind,
			content:    inSelection.getContent(),
			aresId:     inSelection.aresId,
			classes:    inSelection.classes,
			style:      inSelection.style
		};
	},
	getControlPositions: function(inComponents) {
		var controls = this.flattenChildren(inComponents),
			positions = [];
		
		for(var i=0;i<controls.length;i++) {
			if (controls[i].aresId) {
				positions.push({comp: controls[i], rect: controls[i].hasNode().getBoundingClientRect()});
			}
		}
		
		return positions;
	},
	rectsAreEqual: function(inRectA, inRectB) {
		return (inRectA.top === inRectB.top && inRectA.left === inRectB.left && inRectA.bottom === inRectB.bottom && inRectA.right === inRectB.right && inRectA.height === inRectB.height && inRectA.width === inRectB.width);
	},
	checkDragOverBoundary: function(inContainer, x, y) {
		if (!inContainer) {
			return 0;
		}
		
		var bounds = inContainer.hasNode().getBoundingClientRect();
		if (x - bounds.left <= this.edgeThresholdPx) {
			return -1;
		} else if ((bounds.left + bounds.width) - x <= this.edgeThresholdPx) {
			return 1;
		} else if (y - bounds.top <= this.edgeThresholdPx) {
			return -1;
		} else if ((bounds.top + bounds.height) - y <= this.edgeThresholdPx) {
			return 1;
		} else {
			return 0;
		}
	},
	findBeforeItem: function(inContainer, inX, inY) {
		if (!inContainer) {
			return null;
		}
		
		var childData = [],
			aboveItems,
			belowItems,
			rightItems,
			sameRowItems;
		
		// Build up array of nodes
		for (var i = 0; i < inContainer.children.length; i++) {
			if (inContainer.children[i].hasNode()) {
				childData.push(enyo.mixin(
					enyo.clone(inContainer.children[i].node.getBoundingClientRect()),
					{aresId: inContainer.children[i].aresId}
				));
			}
		}
		
		aboveItems = this.findAboveItems(childData, inY);
		// If no above items, place as the first item in this container
		if (aboveItems.length === 0) {
			return childData[0];
		}
		
		belowItems = this.findBelowItems(childData, inY);
		// If no below items, place as the last item in this container
		if (belowItems.length === 0) {
			return null;
		}
		
		// Items on the same row are both above and below the dragged item
		sameRowItems = this.removeDuplicateItems(aboveItems, belowItems);
		
		// If we have items on the same row as the dragged item, find the first item to the left
		if (sameRowItems.length > 0) {
			// If on the same row but no left items, place as the first item on this row
			if (this.findLeftItems(sameRowItems, inX).length === 0) {
				return this.filterArrayForMinValue(sameRowItems, "left");
			// If there are left items, the leftmost right item becomes the before item
			} else {
				rightItems = this.findRightItems(sameRowItems, inX);
				// If there are no items to the right, insert before topmost and leftmost below item
				if(rightItems.length === 0) {
					return this.filterArrayForMinValue(this.findLeftmostItems(belowItems), "top", inY);
				// If there are items to the right, return the leftmost one
				} else {
					return this.filterArrayForMinValue(rightItems, "left");
				}
			}
		}
		
		// If there are no items on the same row as this one, insert before topmost and leftmost below item
		return this.filterArrayForMinValue(this.findLeftmostItems(belowItems), "top");
	},
	//* Return the item in _inContaienr_ that is immediately "after" _inItem_
	findAfterItem: function(inContainer, inItem, inX, inY) {
		if (!inContainer) {
			return null;
		}
		
		var childData = [],
			aboveItems,
			belowItems,
			sameRowItems;
		
		for (var i = 0; i < inContainer.children.length; i++) {
			if (inContainer.children[i].hasNode()) {
				childData.push(enyo.mixin(
					enyo.clone(inContainer.children[i].node.getBoundingClientRect()),
					{aresId: inContainer.children[i].aresId}
				));
			}
		}
		
		// Filter out _inItem_ from _aboveItems_
		aboveItems = this.findAboveItems(childData, inY).filter(function(elem, pos, self) {
			return elem.aresId !== inItem.aresId;
		});
		// Filter out _inItem_ from _belowItems_
		belowItems = this.findBelowItems(childData, inY).filter(function(elem, pos, self) {
			return elem.aresId !== inItem.aresId;
		});
		
		// If no below items, place as the last item in this container
		if (belowItems.length === 0) {
			return null;
		}
		
		// Items on the same row are both above and below the dragged item
		sameRowItems = this.removeDuplicateItems(aboveItems, belowItems);
		
		/**
			If we have items on the same row as the dragged item, find the first item
			to the right of _inItem_
		*/
		if (sameRowItems.length > 0) {
			return this.filterArrayForMinValue(this.findRightItems(sameRowItems, inX), "left");
		}
		
		// If no above items, place as the first item in this container
		if (aboveItems.length === 0) {
			return childData[0];
		}
		
		// If there are no items on the same row as this one, insert before topmost and leftmost below item
		return this.filterArrayForMinValue(this.findLeftmostItems(belowItems), "top");
	},
	findAboveItems: function(inChildren, inY) {
		for (var i = 0, items = []; i < inChildren.length; i++) {
			if (inChildren[i].top - inY < 0) {
				items.push(inChildren[i]);
			}
		}
		return items;
	},
	findBelowItems: function(inChildren, inY) {
		for (var i = 0, items = []; i < inChildren.length; i++) {
			if (inY < inChildren[i].bottom) {
				items.push(inChildren[i]);
			}
		}
		return items;
	},
	findLeftItems: function(inChildren, inX) {
		for (var i = 0, items = []; i < inChildren.length; i++) {
			if (inChildren[i].left < inX) {
				items.push(inChildren[i]);
			}
		}
		return items;
	},
	findRightItems: function(inChildren, inX) {
		for (var i = 0, items = []; i < inChildren.length; i++) {
			if (inX < inChildren[i].right) {
				items.push(inChildren[i]);
			}
		}
		return items;
	},
	findLeftmostItems: function(inItems) {
		var i, val, items = [];
		for (i = 0, val = null; i < inItems.length; i++) {
			if (val === null || inItems[i].left < val) {
				val = inItems[i].left;
			}
		}
		for (i = 0, items = []; i < inItems.length; i++) {
			if (inItems[i].left === val) {
				items.push(inItems[i]);
			}
		}
		return items;
	},
	filterArrayForMinValue: function(inArray, inProp, inMin) {
		for (var i = 0, index = -1; i < inArray.length; i++) {
			if (inMin && inArray[i][inProp] <= inMin) {
				continue;
			}
			if (index === -1 || inArray[i][inProp] <= inArray[index][inProp]) {
				index = i;
			}
		}
		return index === -1 ? null : inArray[index];
	},
	removeDuplicateItems: function(inA, inB) {
		return inA.concat(inB).filter(function(elem, pos, self) {
	    	return self.indexOf(elem) !== pos;
		});
	},
	absolutePositioningMode: function(inControl) {
		return inControl && inControl.layoutKind === "AbsolutePositioningLayout";
	},
	getLayoutData: function(inEvent) {
		var layoutKind = this.selection.parent ? this.selection.parent.layoutKind : null;
		
		switch (layoutKind) {
			case "AbsolutePositioningLayout":
				var bounds = this.getRelativeBounds(this.selection);
				
				return {
					layoutKind: layoutKind,
					bounds: bounds
				};
			default:
				return null;
		}
	},
	getAbsoluteXPosition: function(inEvent) {
		return this.getAbsolutePosition(inEvent, "x");
	},
	getAbsoluteYPosition: function(inEvent) {
		return this.getAbsolutePosition(inEvent, "y");
	},
	getAbsolutePosition: function(inEvent, inAxis) {
		var containerBounds = this.getAbsoluteBounds(this.getContainerItem());
		return (inAxis === "x") ? inEvent.clientX - containerBounds.left : inEvent.clientY - containerBounds.top;
	},
	getRelativeBounds: function(inControl) {
		if (!inControl) {
			return {top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0};
		}
		
		var bounds = inControl.getBounds();
		var absoluteBounds = this.getAbsoluteBounds(inControl);
		var parentBounds = this.getAbsoluteBounds(inControl.parent);
		
		bounds.right = parentBounds.width - bounds.left - absoluteBounds.width;
		bounds.bottom = parentBounds.height - bounds.top - absoluteBounds.height;
		
		return bounds;
	},
	getAbsoluteBounds: function(inControl) {
		var left 			= 0,
			top 			= 0,
			match			= null,
			node 			= inControl.hasNode(),
			width 			= node.offsetWidth,
			height 			= node.offsetHeight,
			transformProp 	= enyo.dom.getStyleTransformProp(),
			xRegEx 		= /translateX\((-?\d+)px\)/i,
			yRegEx 		= /translateY\((-?\d+)px\)/i;

		if (node.offsetParent) {
			do {
				// Fix for FF (GF-2036), offsetParent is working differently between FF and chrome 
				if (enyo.platform.firefox) {					
					left += node.offsetLeft;
					top  += node.offsetTop;
				} else {
					left += node.offsetLeft - (node.offsetParent ? node.offsetParent.scrollLeft : 0);
					top  += node.offsetTop  - (node.offsetParent ? node.offsetParent.scrollTop  : 0);	
				}
				if (transformProp) {
					match = node.style[transformProp].match(xRegEx);
					if (match && typeof match[1] != 'undefined' && match[1]) {
						left += parseInt(match[1], 10);
					}
					match = node.style[transformProp].match(yRegEx);
					if (match && typeof match[1] != 'undefined' && match[1]) {
						top += parseInt(match[1], 10);
					}
				}
			} while (node = node.offsetParent);
		}
		return {
			top		: top,
			left	: left,
			bottom	: document.body.offsetHeight - top  - height,
			right	: document.body.offsetWidth  - left - width,
			height	: height,
			width	: width
		};
	}
});
