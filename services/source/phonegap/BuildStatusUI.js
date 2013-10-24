/* jshint indent: false */ // TODO: ENYO-3311

/* global Phonegap */

/**
 * UI: Phonegap pane in the ProjectProperties popup
 * @name Phonegap.BuildStatusUI
 */
enyo.kind({
	name: "Phonegap.ProjectProperties.PlatformBuildStatus",
	kind: "onyx.IconButton",	
	ontap: "showStatusMessage",	
	published: {
		platform: null,
		status: null,
		userDataRequestTimeout: 2500
	},

	/**
	 * Update the image for the platform IconButton depending on the status of the related platform
	 * described in buildStatusData.
	 * 
	 * @private
	 */
	statusChanged: function() {

		if (this.status === "complete") {
					
			this.setSrc("$services/assets/images/platforms/" + this.platform + "-logo-complete-32x32.png");
			return ; 
		}

		if (this.status === "error"){
			this.show();
			this.setSrc("$services/assets/images/platforms/" + this.platform + "-logo-error-32x32.png");
			return ;
		}
		
		this.setSrc("$services/assets/images/platforms/" + this.platform + "-logo-not-available-32x32.png");
		
	}
});

/**
 * The widget "Build status", show the building state of the application
 * for each platform.  
 */
enyo.kind({
	name: "Phonegap.ProjectProperties.BuildStatus",
	kind: "FittableRows",
	published: {
		appId: "",
		buildStatusData: undefined,
		phongapUrl: "https://build.phonegap.com",
		provider: undefined, 
		selectedPlatform: undefined
	},
	events: {
		onError: ""
	},
	handlers: {
		onUpdateStatusMessage: "updateDownloadMessageContent"
	}, 
	components: [
		{
			name: "buildStatusContainer", kind: "FittableRows", classes: "ares-project-properties-build-status-container",
			components: [
				{	
					name: "platformIconContainer",
					classes:"ares-project-properties-platform-icon-container",
					kind: "FittableColumns",					
				},				

				{ name: "downloadStatus", kind: "Phonegap.ProjectProperties.DownloadStatus" },
				{
					name: "messageContainer",
					classes: "ares-project-properties-status-message-container",
					showing: false,
					components: [
						{
							name: "hideStatusContainer",
							kind: "onyx.IconButton",
							src: "$project-view/assets/images/close-button-16x16.png",
							classes: "ares-project-properties-hide-status-button",
							ontap:"hideMessageContainer"
						},				
						{
							name: "statusMessage",
							classes: "ares-project-properties-status-message"
						}
					]
				},
				{
					kind: "FittableColumns",
					style: "height: 32px; position: relative; top:-6em;",
					components: [
						{
							name:"separatorForDownloadButton"
						},
						{
							name: "downloadButton",
							kind: "onyx.IconButton",
							src: "$services/assets/images/download-icon.png",
							showing: false,
							ontap: "downloadPackage"
						}
					]
				}
									
			]
		}
	],
	/**@private*/
	create: function() {
		this.inherited(arguments);
		this.createIconButtons();
		this.appIdChanged();
		this.setProvider(Phonegap.ProjectProperties.getProvider());
	},

	/**
	 * Create the IconButtons displaying the build state of the application
	 * for all platforms defined in the object {Phonegap.ProjectProperties.downloadStatus}
	 * 
	 * @private
	 */
	createIconButtons: function() {
		for (var key in Phonegap.ProjectProperties.downloadStatus) {
			this.$.platformIconContainer.createComponent(
				{
					name: key + "Decorator", 
					classes: "ares-project-properties-build-status-icon",
					components: [						
						{
							name: key + "Button", 
							kind: "Phonegap.ProjectProperties.PlatformBuildStatus", 
							platform: key
						}
					]
				}, 
				{owner: this}
			);			
		}
	},

	/**
	 * Charge the icon showing the build status of the application of a a given platform depending on 
	 * its status. the status is checked from the "buildStatusData" object.
	 * By clicking on the icon, the status message is displayed.
	 * 
	 * @private	 
	 */
	buildStatusDataChanged: function(){
		var pendingApplication = false;
		
		//Check if there is a pending build.
		for(var key1 in this.buildStatusData && this.buildStatusData.status) {
			if (this.buildStatusData.status[key1] === "pending") {
				pendingApplication = true;
			}
		}

		//If there is a pending build, another buildStatus Request is sent after 600 ms timeout.
		if (pendingApplication) {
			setTimeout(this.sendBuildStatusRequest(), this.userDataRequestTimeout); 
		}

		// Get only the Enyo control that have the "platform" attribute 
		// => {Phonegap.ProjectProperties.PlatformBuildStatus} instance
		for(var key2 in this.$){

			var platform = this.$[key2].platform;
			var status = this.buildStatusData && this.buildStatusData.status[platform];
			
			if (platform !== undefined) {				
				this.$[key2].setStatus(status);
			}
		}

		//Update to Status container if a platform is selected.
		if(this.selectedPlatform !== undefined) {
			this.showStatusMessage({platform: this.selectedPlatform});
		}		
	
		this.$.buildStatusContainer.render();

	},

	/**
	 * Use the phonegap service to request a {buildStatus} object from Phonegap build
	 * @private
	 */
	sendBuildStatusRequest: function() {
		
		if(this.appId === "" || this.appId === undefined){
			this.setBuildStatusData(null);
		} else {
			this.provider.getAppData(this.appId, enyo.bind(this, this.getBuildStatusData));
		}
	},

	/**
	 * Update the content of the statusMessage row.
	 * @protected
	 */
	updateDownloadMessageContent: function() {

		this.$.statusMessage.setContent(this.$.downloadStatus.getDownloadStatus(this.selectedPlatform));
		this.$.statusMessage.show();
		this.updateDownloadMessageDisplay(this.selectedPlatform);		

		//stop the propagation of the bubble event
		return true;
	},

	/**
	 * Highlight the selected platform button by appling a css style on its decorator.
	 * @param {enyo.component} inIconButtonDecorator decorator of the button
	 * @private
	 */
	addHightlightIconButton: function(inIconButtonDecorator) {
		this.removeHightlightIconButton();
		inIconButtonDecorator.addClass("ares-project-properties-buildStatus-icon-highlight");

	},

	/**
	 * Remove the highlignt effect from all platform buttons.
	 * @private
	 */
	removeHightlightIconButton: function() {
		for(var key in Phonegap.ProjectProperties.downloadStatus) {
			this.$[key + "Decorator"].removeClass("ares-project-properties-buildStatus-icon-highlight");			
		}
	},

	/**
	 * 
	 * @param  {String} inPlatform Mobile platform supported by Phonegap.
	 * @private
	 */
	updateDownloadMessageDisplay: function(inPlatform) {
		var classAttribute = "ares-project-properties-buildStatus-download-button-" + inPlatform;
		this.$.separatorForDownloadButton.setClassAttribute(classAttribute);

		this.$.downloadButton.show();
	},

	/**@private*/
	showStatusMessage: function(inSender){

		this.setSelectedPlatform(inSender.platform);
		this.$.messageContainer.show();
		this.addHightlightIconButton(this.$[inSender.platform+ "Decorator"]);

		//Build status: complete
		if (this.buildStatusData && this.buildStatusData.status[inSender.platform] === "complete") {

				this.updateDownloadMessageContent();
				this.updateDownloadMessageDisplay(inSender.platform);
		
		} else {
			this.$.downloadButton.hide();

			if (this.buildStatusData && this.buildStatusData.status[inSender.platform] === "error" || 
				this.buildStatusData && this.buildStatusData.status[inSender.platform] === null){

				//Build status: error
				this.$.statusMessage.setContent("Error: " + this.buildStatusData.error[inSender.platform]);				
			
			} else {
				
				if(this.buildStatusData === null) {
					
					//Build status: application not built
					this.$.statusMessage.setContent("Build the application first");					

				} else {
					
					//Build status: pending					
					this.$.statusMessage.setContent("Build in progress");					
				}		
			}
		}

		//stop the propagation of the bubble event
		return true; 
	},

	/**
	 * Listener to launch the download request form the Phonegap Build service manager.
	 * @param  {Object} inSender 
	 * @param  {Object} inEvent  
	 * @private
	 */
	downloadPackage: function(inSender, inEvent) {

		var projectConfig = this.owner.getProject();
		this.provider.downloadPackage(projectConfig, this.selectedPlatform, this.buildStatusData, enyo.bind(this, this.getPackage));

		//set the download status to "Download on progress"
		this.$.downloadStatus.setDownloadStatus(this.selectedPlatform, 2);		
	},

	/**
	 * Callback used in the function "downloadPackage()"" in "Build.js"
	 * Update the status message to show the current status of the download request.
	 * 
	 * @param  {Object} err       error object
	 * @private
	 */
	getPackage: function(err) {
		if(err) {
			//set the download status to "Download failed"
			this.$.downloadStatus.setDownloadStatus(this.selectedPlatform, 0);
		} else {
			//set the download status to "Download complete"
			this.$.downloadStatus.setDownloadStatus(this.selectedPlatform, 1);
		}
	},	

	/**@private*/
	hideMessageContainer: function() {
		//Unselect the focused platform
		this.setSelectedPlatform(undefined);
		this.removeHightlightIconButton();
		
		this.$.messageContainer.hide();
		this.$.downloadButton.hide();
	},

	/**@private*/
	hideMessageContent: function() {
		this.$.downloadButton.hide();
	}, 

	/**@private*/
	appIdChanged: function(){
		this.sendBuildStatusRequest();		
	},

	/**
	 * Callback function to initialize the "buildStatusData" object. 
	 * 
	 * @param  {Object} err               error object
	 * @param  {Object} inBuildStatusData Object returned by Phonegap build, it contains several informations
	 *                                    about the built application.
	 * @private
	 */
	getBuildStatusData: function (err, inBuildStatusData) {
		if (err) {
			this.doError({msg: err.toString(), err: err});
		} else {
			this.setBuildStatusData(inBuildStatusData.user);
		}
	}
});

/**
 * Model kind to keep track on the download status for each
 * mobile platform supported by Phonegap Build.
 *
 * Used only by the widget {Phonegap.ProjectProperties.BuildStatus}
 */
enyo.kind({
	name: "Phonegap.ProjectProperties.DownloadStatus",

	/**
	 * Set the download status for a platform defined in {this.downloadStatus}.
	 * 
	 * @param {String} inPlatform       platform defined in {this.downloadStatus}
	 * @param {integer} inDownloadStatus code status: 0 => failed, 1 => complete, other => on progress
	 * @public
	 */
	setDownloadStatus: function(inPlatform, inDownloadStatus) {
		if(inDownloadStatus === 1){
			Phonegap.ProjectProperties.downloadStatus[inPlatform] = "Download complete";			
		} else {
			if (inDownloadStatus === 0) {
				Phonegap.ProjectProperties.downloadStatus[inPlatform] = "Download failed";
			} else {
				Phonegap.ProjectProperties.downloadStatus[inPlatform] = "Download on progress";
			}
		}

		this.bubble("onUpdateStatusMessage");	
	},

	/**
	 * Get the download status value by platform.
	 * 
	 * @param  {String} inPlatform [description]
	 * @return {String} status message
	 * @public
	 */
	getDownloadStatus: function(inPlatform) {
		return Phonegap.ProjectProperties.downloadStatus[inPlatform];
	}	

});