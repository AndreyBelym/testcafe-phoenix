export default function (messages, context) {
    if (!context.displayedMessageIndex)
        context.displayedMessageIndex = Math.floor(Math.random() * messages.length);
    else
        context.displayedMessageIndex = (context.displayedMessageIndex + 1) % messages.length;

    return context.displayedMessageIndex;
}
